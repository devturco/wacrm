import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  accountName: 'Studio Bella',
  existing: null as Record<string, unknown> | null,
  takenNames: [] as string[],
  createInstance: vi.fn(async () => {}),
  setWebhook: vi.fn(async () => {}),
  updateInstance: vi.fn(async () => {}),
  deleteInstance: vi.fn(async () => {}),
  getConnectionState: vi.fn(async () => ({
    state: 'open' as const,
    connected: true,
    suspended: false,
  })),
  upsertWhatsmiauConfig: vi.fn(
    async (_db: unknown, _accountId: string, patch: unknown) => ({
      id: 'row-1',
      ...(patch as Record<string, unknown>),
    }),
  ),
  updateWhatsmiauConfigById: vi.fn(async () => null),
  deleteWhatsmiauConfig: vi.fn(async () => {}),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    supabase: h.db,
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
    account: { id: 'acc-1', name: h.accountName },
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
    loadWhatsmiauConfigByInstanceName: vi.fn(async () => h.existing),
    loadWhatsmiauConfigs: vi.fn(async () => (h.existing ? [h.existing] : [])),
    isProviderInstanceNameTaken: vi.fn(
      async (_db: unknown, name: string) => h.takenNames.includes(name),
    ),
    upsertWhatsmiauConfig: h.upsertWhatsmiauConfig,
    updateWhatsmiauConfigById: h.updateWhatsmiauConfigById,
    deleteWhatsmiauConfig: h.deleteWhatsmiauConfig,
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
    setWebhook: h.setWebhook,
    updateInstance: h.updateInstance,
    deleteInstance: h.deleteInstance,
    getConnectionState: h.getConnectionState,
  };
});

import { POST } from '../instances/route';
import { GET as GET_INSTANCE, PUT } from '../instances/[name]/route';

const CUSTOMER_NAME = 'Atendimento 01';
const PROVIDER_NAME = 'studio_bella_atendimento_01';

function configRow() {
  return {
    id: 'row-1',
    account_id: 'acc-1',
    instance_name: CUSTOMER_NAME,
    provider_instance_name: PROVIDER_NAME,
    webhook_secret: 'secret-abc',
    status: 'connected',
    phone_number: '5511999999999',
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
    h.existing = null;
    h.takenNames = [];
    h.accountName = 'Studio Bella';
    h.createInstance.mockClear();
    h.setWebhook.mockClear();
    h.deleteInstance.mockClear();
    h.upsertWhatsmiauConfig.mockClear();
    // The provider credential belongs to the platform.
    vi.stubEnv('WHATSMIAU_API_KEY', 'platform-key');
    // The canonical public origin — pinned so the test does not depend
    // on the developer's own .env.local.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an empty instance name', async () => {
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: '   ' }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('instance_name');
    expect(h.createInstance).not.toHaveBeenCalled();
  });

  it('accepts a name with accents — it never reaches the provider', async () => {
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: 'Atendimento Principal' }),
      }),
    );

    expect(res.status).toBe(200);
    const [, args] = h.createInstance.mock.calls[0] as unknown as [
      unknown,
      { instanceName: string },
    ];
    // The provider only ever sees the slugged, namespaced name — the
    // accents are gone and the whole thing fits the provider's limit.
    expect(args.instanceName).toBe('studio_bella_atendimento_princip');
    expect(args.instanceName).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(args.instanceName.length).toBeLessThanOrEqual(40);
  });

  it('refuses a name the account already uses', async () => {
    h.existing = configRow();
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: CUSTOMER_NAME }),
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('instance_name_taken');
    expect(h.createInstance).not.toHaveBeenCalled();
  });

  it('refuses to create a connection without a company name', async () => {
    h.accountName = '';
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: CUSTOMER_NAME }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('company_name_missing');
    expect(h.createInstance).not.toHaveBeenCalled();
  });

  it('creates the instance and pushes our webhook with the locked Authorization header', async () => {
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: CUSTOMER_NAME }),
      }),
    );

    expect(res.status).toBe(200);
    expect(h.createInstance).toHaveBeenCalledTimes(1);
    const [conn, args] = h.createInstance.mock.calls[0] as unknown as [
      { apiKey: string; instanceName: string },
      { instanceName: string; settings: { webhook: { url: string; headers: Record<string, string> } } },
    ];
    // The credential is the platform's — never the customer's.
    expect(conn.apiKey).toBe('platform-key');
    expect(args.instanceName).toBe(PROVIDER_NAME);
    expect(args.settings.webhook.url).toBe('https://app.test/api/whatsmiau/webhook');
    // The locked header carries a freshly generated secret — the one
    // the route wrote to the row.
    expect(args.settings.webhook.headers.Authorization).toMatch(/^Bearer [0-9a-f]{64}$/);
    expect(h.setWebhook).toHaveBeenCalledTimes(1);
  });

  it('never stores the locked Authorization header in the database row', async () => {
    await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: CUSTOMER_NAME }),
      }),
    );

    const [, , patch] = h.upsertWhatsmiauConfig.mock.calls[0] as unknown as [
      unknown,
      unknown,
      {
        instance_name: string;
        provider_instance_name: string;
        instance_settings: { webhook: { headers: Record<string, string>; url: string } };
      },
    ];
    expect(patch.instance_name).toBe(CUSTOMER_NAME);
    expect(patch.provider_instance_name).toBe(PROVIDER_NAME);
    expect(patch.instance_settings.webhook.headers.Authorization).toBeUndefined();
    expect(patch.instance_settings.webhook.url).toBe('https://app.test/api/whatsmiau/webhook');
  });

  it('suffixes the provider name when it is already taken', async () => {
    h.takenNames = [PROVIDER_NAME];
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: CUSTOMER_NAME }),
      }),
    );

    expect(res.status).toBe(200);
    const [, , patch] = h.upsertWhatsmiauConfig.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { provider_instance_name: string },
    ];
    expect(patch.provider_instance_name).toBe('studio_bella_atendimento_01_2');
  });

  it('pushes the webhook to the canonical public address, not to the request one', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    const res = await POST(
      new Request('http://localhost:3000/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: CUSTOMER_NAME }),
      }),
    );

    expect(res.status).toBe(200);
    const [, args] = h.createInstance.mock.calls[0] as unknown as [
      unknown,
      { settings: { webhook: { url: string } } },
    ];
    expect(args.settings.webhook.url).toBe('https://crm.example.com/api/whatsmiau/webhook');
  });

  it('refuses to create a connection when the webhook address is unreachable', async () => {
    // The provider refuses a development address (its anti-SSRF
    // guard) — so the app refuses it first, with a message that says
    // what to do, instead of spending a round trip on a dead end.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    const res = await POST(
      new Request('http://localhost:3000/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: CUSTOMER_NAME }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('webhook_url_unreachable');
    expect(body.error).toMatch(/not reachable/i);
    // The customer did not configure the deployment: no environment
    // variable and no address leak into the answer.
    expect(body.error).not.toMatch(/NEXT_PUBLIC_SITE_URL/);
    expect(body.error).not.toMatch(/localhost/);
    // Nothing was created at the provider.
    expect(h.createInstance).not.toHaveBeenCalled();
  });

  it('removes the instance at the provider when the webhook registration fails', async () => {
    h.setWebhook.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { name: 'WhatsmiauApiError' }),
    );

    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: CUSTOMER_NAME }),
      }),
    );

    expect(res.status).toBe(500);
    // The instance existed at the provider — it must not stay there
    // with no row of ours pointing at it.
    expect(h.deleteInstance).toHaveBeenCalledTimes(1);
    const [, name] = h.deleteInstance.mock.calls[0] as unknown as [
      unknown,
      string,
    ];
    expect(name).toBe(PROVIDER_NAME);
    // And no row was written.
    expect(h.upsertWhatsmiauConfig).not.toHaveBeenCalled();
  });
});

describe('GET /api/whatsmiau/instances/[name]', () => {
  beforeEach(() => {
    h.existing = configRow();
    h.getConnectionState.mockClear();
    vi.stubEnv('WHATSMIAU_API_KEY', 'platform-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers 404 for an instance that belongs to another account', async () => {
    h.existing = null;
    const res = await GET_INSTANCE(new Request('https://app.test'), {
      params: Promise.resolve({ name: CUSTOMER_NAME }),
    });

    expect(res.status).toBe(404);
    expect(h.getConnectionState).not.toHaveBeenCalled();
  });

  it('answers the connection state for our own instance', async () => {
    const res = await GET_INSTANCE(new Request('https://app.test'), {
      params: Promise.resolve({ name: CUSTOMER_NAME }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'open', connected: true });
  });
});

describe('PUT /api/whatsmiau/instances/[name]', () => {
  beforeEach(() => {
    h.existing = configRow();
    h.updateInstance.mockClear();
    h.setWebhook.mockClear();
    h.updateWhatsmiauConfigById.mockClear();
    vi.stubEnv('WHATSMIAU_API_KEY', 'platform-key');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends the account settings to the provider under the namespaced name', async () => {
    const res = await PUT(
      new Request(`https://app.test/api/whatsmiau/instances/${CUSTOMER_NAME}`, {
        method: 'PUT',
        body: JSON.stringify({ settings: { readMessages: true } }),
      }),
      { params: Promise.resolve({ name: CUSTOMER_NAME }) },
    );

    expect(res.status).toBe(200);
    const [, name, settings] = h.updateInstance.mock.calls[0] as unknown as [
      unknown,
      string,
      { readMessages: boolean; groupsIgnore: boolean },
    ];
    expect(name).toBe(PROVIDER_NAME);
    expect(settings.readMessages).toBe(true);
    expect(settings.groupsIgnore).toBe(true);
  });

  it('never stores the locked Authorization header in the database row', async () => {
    await PUT(
      new Request(`https://app.test/api/whatsmiau/instances/${CUSTOMER_NAME}`, {
        method: 'PUT',
        body: JSON.stringify({ settings: { readMessages: true } }),
      }),
      { params: Promise.resolve({ name: CUSTOMER_NAME }) },
    );

    const [, , patch] = h.updateWhatsmiauConfigById.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { instance_settings: { webhook: { headers: Record<string, string> } } },
    ];
    expect(patch.instance_settings.webhook.headers.Authorization).toBeUndefined();
  });

  it('answers 404 for an instance that belongs to another account', async () => {
    h.existing = null;
    const res = await PUT(
      new Request(`https://app.test/api/whatsmiau/instances/${CUSTOMER_NAME}`, {
        method: 'PUT',
        body: JSON.stringify({ settings: {} }),
      }),
      { params: Promise.resolve({ name: CUSTOMER_NAME }) },
    );

    expect(res.status).toBe(404);
    expect(h.updateInstance).not.toHaveBeenCalled();
  });
});
