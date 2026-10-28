import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  accountName: 'Studio Bella',
  rows: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { name: h.accountName }, error: null }),
          }),
        }),
      }),
    },
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

vi.mock('@/lib/whatsapp/whatsmiau-config', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/whatsmiau-config')>();
  return {
    ...actual,
    loadWhatsmiauConfigs: vi.fn(async () => h.rows),
  };
});

import { GET } from './route';

const CUSTOMER_NAME = 'Atendimento 01';
const PROVIDER_NAME = 'studio_bella_atendimento_01';
const SECRET = 'a'.repeat(64);

function row() {
  return {
    id: 'wm-1',
    account_id: 'acc-1',
    instance_name: CUSTOMER_NAME,
    provider_instance_name: PROVIDER_NAME,
    webhook_secret: SECRET,
    status: 'connected',
    phone_number: '5511999999999',
    wuid: null,
    is_active: true,
    instance_settings: {
      alwaysOnline: false,
      readMessages: false,
      rejectCall: true,
      msgCall: '',
      groupsIgnore: true,
      saveMedia: true,
      webhook: {
        enabled: true,
        url: 'https://app.test/api/whatsmiau/webhook',
        headers: { Authorization: `Bearer ${SECRET}`, 'X-Custom': 'ok' },
        events: ['messages.upsert'],
        base64: false,
      },
    },
    connected_at: '2026-10-27T10:00:00Z',
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T10:00:00Z',
  };
}

describe('GET /api/whatsmiau/config', () => {
  beforeEach(() => {
    h.accountName = 'Studio Bella';
    h.rows = [row()];
    vi.stubEnv('WHATSMIAU_API_KEY', 'platform-key');
    // The canonical public origin — the same one the server pushes to
    // the provider. Pinned here so the test does not depend on the
    // developer's own .env.local.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function request(origin = 'https://app.test') {
    return new Request(`${origin}/api/whatsmiau/config`);
  }

  it('reports whether the platform credential is configured', async () => {
    const res = await GET(request());
    const body = await res.json();
    expect(body.configured).toBe(true);

    vi.stubEnv('WHATSMIAU_API_KEY', '');
    const offline = await (await GET(request())).json();
    expect(offline.configured).toBe(false);
  });

  it('returns the company name and the account instances', async () => {
    const body = await (await GET(request())).json();
    expect(body.company_name).toBe('Studio Bella');
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0].instance_name).toBe(CUSTOMER_NAME);
    expect(body.instances[0].status).toBe('connected');
    expect(body.instances[0].is_active).toBe(true);
  });

  it('tells the screen the address the server pushes to the provider', async () => {
    const body = await (await GET(request())).json();
    expect(body.webhook_url).toBe('https://app.test/api/whatsmiau/webhook');

    // On a development address the server falls back to the canonical
    // public one — that is the address the provider can reach.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    const pinned = await (await GET(request('http://localhost:3000'))).json();
    expect(pinned.webhook_url).toBe('https://crm.example.com/api/whatsmiau/webhook');
  });

  it('never sends the provider name to the browser', async () => {
    const raw = await (await GET(request())).text();
    expect(raw).not.toContain(PROVIDER_NAME);
  });

  it('never sends the webhook secret to the browser', async () => {
    const raw = await (await GET(request())).text();
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('Bearer');
  });

  it('keeps the user own webhook headers', async () => {
    const body = await (await GET(request())).json();
    expect(body.instances[0].instance_settings.webhook.headers).toEqual({
      'X-Custom': 'ok',
    });
  });
});
