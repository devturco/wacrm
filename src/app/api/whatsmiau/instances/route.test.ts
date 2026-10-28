import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  config: null as Record<string, unknown> | null,
  createInstance: vi.fn(async () => {}),
  listInstances: vi.fn(async () => []),
  setWebhook: vi.fn(async () => {}),
  updateInstance: vi.fn(async () => {}),
  getConnectionState: vi.fn(async () => ({
    state: 'open' as const,
    connected: true,
    suspended: false,
  })),
  upsertWhatsmiauConfig: vi.fn(async (_db: unknown, _accountId: string, patch: unknown) => ({
    ...(h.config ?? {}),
    ...(patch as Record<string, unknown>),
  })),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    supabase: h.db,
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
  })),
  toErrorResponse: vi.fn(
    (error: unknown) =>
      Response.json(
        { error: error instanceof Error ? error.message : 'error' },
        { status: 500 },
      ),
  ),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (text: string) => `enc:${text}`,
  decrypt: (text: string) => text.replace(/^enc:/, ''),
  isLegacyFormat: () => false,
}));

vi.mock('@/lib/whatsapp/whatsmiau-config', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/whatsmiau-config')>();
  return {
    ...actual,
    loadWhatsmiauConfig: vi.fn(async () => h.config),
    upsertWhatsmiauConfig: h.upsertWhatsmiauConfig,
  };
});

vi.mock('@/lib/whatsapp/providers/whatsmiau/instances', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/whatsapp/providers/whatsmiau/instances')
    >();
  return {
    ...actual,
    createInstance: h.createInstance,
    listInstances: h.listInstances,
    setWebhook: h.setWebhook,
    updateInstance: h.updateInstance,
    getConnectionState: h.getConnectionState,
  };
});

import { POST } from '../instances/route';
import { GET as GET_INSTANCE, PUT } from '../instances/[name]/route';

function configRow() {
  return {
    id: 'row-1',
    account_id: 'acc-1',
    instance_name: 'Atendimento01',
    api_key_encrypted: 'enc:key-123',
    base_url: 'https://api.whatsmiau.dev/v2',
    webhook_secret: 'secret-abc',
    status: 'connected',
    phone_number: '5511999988888',
    wuid: null,
    is_active: false,
    instance_settings: {
      alwaysOnline: false,
      readMessages: false,
      rejectCall: true,
      msgCall: '',
      groupsIgnore: true,
      saveMedia: true,
      webhook: {
        enabled: true,
        url: '',
        headers: {},
        events: ['messages.upsert'],
        base64: false,
      },
    },
    connected_at: '2026-10-27T10:00:00Z',
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T10:00:00Z',
  };
}

describe('POST /api/whatsmiau/instances', () => {
  beforeEach(() => {
    h.config = configRow();
    h.createInstance.mockClear();
    h.setWebhook.mockClear();
    h.upsertWhatsmiauConfig.mockClear();
  });

  it('rejects an invalid instance name and explains the rule', async () => {
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: 'nome com acento' }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('instance_name');
    expect(body.error).toMatch(/letters, numbers, dot, hyphen and underscore/);
    expect(h.createInstance).not.toHaveBeenCalled();
  });

  it('creates the instance and pushes our webhook with the locked Authorization header', async () => {
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: 'Atendimento01' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(h.createInstance).toHaveBeenCalledTimes(1);
    const [conn, args] = h.createInstance.mock.calls[0] as unknown as [
      { apiKey: string },
      { instanceName: string; settings: { webhook: { url: string; headers: Record<string, string> } } },
    ];
    expect(conn.apiKey).toBe('key-123');
    expect(args.instanceName).toBe('Atendimento01');
    expect(args.settings.webhook.url).toBe('https://app.test/api/whatsmiau/webhook');
    expect(args.settings.webhook.headers.Authorization).toBe('Bearer secret-abc');
    expect(h.setWebhook).toHaveBeenCalledTimes(1);
  });

  it('never stores the locked Authorization header in the database row', async () => {
    await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: 'Atendimento01' }),
      }),
    );

    const [, , patch] = h.upsertWhatsmiauConfig.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { instance_settings: { webhook: { headers: Record<string, string>; url: string } } },
    ];
    expect(patch.instance_settings.webhook.headers.Authorization).toBeUndefined();
    expect(patch.instance_settings.webhook.url).toBe('https://app.test/api/whatsmiau/webhook');
  });
});

describe('GET /api/whatsmiau/instances/[name]', () => {
  beforeEach(() => {
    h.config = configRow();
  });

  it('answers 404 for an instance that belongs to another account', async () => {
    h.config = { ...configRow(), instance_name: 'OutraEmpresa' };
    const res = await GET_INSTANCE(new Request('https://app.test'), {
      params: Promise.resolve({ name: 'Atendimento01' }),
    });

    expect(res.status).toBe(404);
    expect(h.getConnectionState).not.toHaveBeenCalled();
  });

  it('answers the connection state for our own instance', async () => {
    const res = await GET_INSTANCE(new Request('https://app.test'), {
      params: Promise.resolve({ name: 'Atendimento01' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'open', connected: true });
  });
});

describe('PUT /api/whatsmiau/instances/[name]', () => {
  beforeEach(() => {
    h.config = configRow();
    h.updateInstance.mockClear();
    h.setWebhook.mockClear();
    h.upsertWhatsmiauConfig.mockClear();
  });

  it('sends the account settings to the provider', async () => {
    const res = await PUT(
      new Request('https://app.test/api/whatsmiau/instances/Atendimento01', {
        method: 'PUT',
        body: JSON.stringify({ settings: { readMessages: true } }),
      }),
      { params: Promise.resolve({ name: 'Atendimento01' }) },
    );

    expect(res.status).toBe(200);
    const [, name, settings] = h.updateInstance.mock.calls[0] as unknown as [
      unknown,
      string,
      { readMessages: boolean; groupsIgnore: boolean },
    ];
    expect(name).toBe('Atendimento01');
    expect(settings.readMessages).toBe(true);
    expect(settings.groupsIgnore).toBe(true);
  });

  it('never stores the locked Authorization header in the database row', async () => {
    await PUT(
      new Request('https://app.test/api/whatsmiau/instances/Atendimento01', {
        method: 'PUT',
        body: JSON.stringify({ settings: { readMessages: true } }),
      }),
      { params: Promise.resolve({ name: 'Atendimento01' }) },
    );

    const [, , patch] = h.upsertWhatsmiauConfig.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { instance_settings: { webhook: { headers: Record<string, string> } } },
    ];
    expect(patch.instance_settings.webhook.headers.Authorization).toBeUndefined();
  });

  it('answers 404 for an instance that belongs to another account', async () => {
    h.config = { ...configRow(), instance_name: 'OutraEmpresa' };
    const res = await PUT(
      new Request('https://app.test/api/whatsmiau/instances/Atendimento01', {
        method: 'PUT',
        body: JSON.stringify({ settings: {} }),
      }),
      { params: Promise.resolve({ name: 'Atendimento01' }) },
    );

    expect(res.status).toBe(404);
    expect(h.updateInstance).not.toHaveBeenCalled();
  });
});
