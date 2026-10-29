import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The state the fakes share with the mocked modules.
 *
 * `vi.mock` factories are hoisted above the module body, so the
 * values they touch have to be hoisted too.
 */
const h = vi.hoisted(() => ({
  role: '' as string,
  queries: [] as Array<{ table: string; filters: string[] }>,
  rows: [] as Record<string, unknown>[],
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
      role: 'viewer',
      supabase: {
        from: (table: string) => {
          const filters: string[] = [];
          const builder = {
            select: () => builder,
            eq: (column: string, value: unknown) => {
              filters.push(`${column}=${String(value)}`);
              return builder;
            },
            order: () => builder,
            then: (resolve: (value: unknown) => unknown) =>
              resolve({ data: h.rows, error: null }),
          };
          h.queries.push({ table, filters });
          return builder;
        },
      },
    };
  },
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 500,
  }),
}));

import { GET } from './route';

type Res = { status: number; body: Record<string, unknown> };

const CONTACT = '11111111-1111-4111-8111-111111111111';

function get(contactId: string | null) {
  const url = new URL('http://t/api/leads/origins');
  if (contactId !== null) url.searchParams.set('contactId', contactId);
  return GET(new Request(url)) as unknown as Promise<Res>;
}

beforeEach(() => {
  h.role = '';
  h.queries = [];
  h.rows = [];
});

describe('GET /api/leads/origins', () => {
  it('asks for the viewer role', async () => {
    await get(CONTACT);
    expect(h.role).toBe('viewer');
  });

  it('returns the journey of the contact', async () => {
    h.rows = [{ id: 'origin-1', contact_id: CONTACT }];
    const res = await get(CONTACT);
    expect(res.status).toBe(200);
    expect(res.body.origins).toHaveLength(1);
  });

  it('scopes the query to the account', async () => {
    await get(CONTACT);
    expect(h.queries[0]?.table).toBe('lead_origins');
    expect(h.queries[0]?.filters).toContain('account_id=acc-1');
    expect(h.queries[0]?.filters).toContain(`contact_id=${CONTACT}`);
  });

  it('refuses a contact id that is not a uuid', async () => {
    const res = await get('not-a-uuid');
    expect(res.status).toBe(400);
    expect(h.queries).toHaveLength(0);
  });

  it('refuses a missing contact id', async () => {
    const res = await get(null);
    expect(res.status).toBe(400);
  });
});
