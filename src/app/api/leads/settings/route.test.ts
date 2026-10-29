import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The state the fakes share with the mocked modules.
 *
 * `vi.mock` factories are hoisted above the module body, so the
 * values they touch have to be hoisted too.
 */
const h = vi.hoisted(() => ({
  role: '' as string,
  settings: null as {
    account_id: string;
    capture_key: string;
    enabled: boolean;
    allowed_hosts: string[];
    links: unknown[];
  } | null,
  updates: [] as Array<{ accountId: string; patch: Record<string, unknown> }>,
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (min: string) => {
    h.role = min;
    return {
      accountId: 'acc-1',
      userId: 'user-1',
      role: 'admin',
      supabase: {},
    };
  },
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 500,
  }),
}));

vi.mock('@/lib/leads/store', () => ({
  createLeadSettingsStore: () => ({
    read: async () => h.settings,
    create: async () => {
      throw new Error('create() must not be called by the route');
    },
    update: async (accountId: string, patch: Record<string, unknown>) => {
      h.updates.push({ accountId, patch });
      return {
        account_id: accountId,
        capture_key: String(patch.capture_key ?? ''),
        enabled: patch.enabled === true,
        allowed_hosts: (patch.allowed_hosts as string[]) ?? [],
        links: (patch.links as unknown[]) ?? [],
      };
    },
  }),
}));

import { GET, PUT } from './route';

type Res = { status: number; body: Record<string, unknown> };

function put(body: unknown) {
  return PUT(
    new Request('http://t/api/leads/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<Res>;
}

beforeEach(() => {
  h.role = '';
  h.settings = null;
  h.updates = [];
});

describe('GET /api/leads/settings', () => {
  it('asks for the viewer role', async () => {
    await GET();
    expect(h.role).toBe('viewer');
  });

  it('says the account is not configured yet', async () => {
    const res = (await GET()) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.capture_key).toBeNull();
  });

  it("returns the account's configuration", async () => {
    h.settings = {
      account_id: 'acc-1',
      capture_key: 'pk_abc',
      enabled: true,
      allowed_hosts: ['site.com.br'],
      links: [],
    };
    const res = (await GET()) as unknown as Res;
    expect(res.body.configured).toBe(true);
    expect(res.body.capture_key).toBe('pk_abc');
    expect(res.body.allowed_hosts).toEqual(['site.com.br']);
  });
});

describe('PUT /api/leads/settings', () => {
  it('asks for the admin role', async () => {
    await put({ enabled: true, allowed_hosts: [], links: [] });
    expect(h.role).toBe('admin');
  });

  it('keeps the capture key the account already has', async () => {
    h.settings = {
      account_id: 'acc-1',
      capture_key: 'pk_existing',
      enabled: false,
      allowed_hosts: [],
      links: [],
    };
    await put({ enabled: true, allowed_hosts: [], links: [] });
    expect(h.updates[0]?.patch.capture_key).toBe('pk_existing');
  });

  it('generates a capture key when the account has none', async () => {
    await put({ enabled: true, allowed_hosts: [], links: [] });
    const key = String(h.updates[0]?.patch.capture_key ?? '');
    expect(key).toMatch(/^pk_[0-9a-f]{32}$/);
  });

  it('normalizes the hosts', async () => {
    await put({
      enabled: true,
      allowed_hosts: ['https://Site.com.br/oferta', 'site.com.br'],
      links: [],
    });
    expect(h.updates[0]?.patch.allowed_hosts).toEqual(['site.com.br']);
  });

  it('refuses a host list that is not a list', async () => {
    const res = await put({
      enabled: true,
      allowed_hosts: 'site.com.br',
      links: [],
    });
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });

  it('refuses a destination that is neither a number nor a URL', async () => {
    const res = await put({
      enabled: true,
      allowed_hosts: [],
      links: [{ label: 'x', destination: 'javascript:alert(1)' }],
    });
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });

  it('gives a new link a code', async () => {
    await put({
      enabled: true,
      allowed_hosts: [],
      links: [{ label: 'Verão', destination: 'wa:5511999999999' }],
    });
    const links = h.updates[0]?.patch.links as Array<{ code: string }>;
    expect(links[0]?.code).toMatch(/^[a-z0-9]{8}$/);
  });

  it('refuses two links with the same code', async () => {
    const res = await put({
      enabled: true,
      allowed_hosts: [],
      links: [
        { code: 'abcd1234', destination: 'wa:5511999999999' },
        { code: 'abcd1234', destination: 'wa:5511999999999' },
      ],
    });
    expect(res.status).toBe(400);
  });
});
