import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The state the fakes share with the mocked modules.
 *
 * `vi.mock` factories are hoisted above the module body, so the
 * values they touch have to be hoisted too — `vi.hoisted` is the
 * supported way to do it.
 */
const fake = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  settingsRow: null as Record<string, unknown> | null,
}));

/**
 * The builder the store drives.
 *
 * It is thenable: every filter method returns the builder itself and
 * the `await` at the end of the chain resolves to `{ data, error }`,
 * exactly like the real PostgREST builder.
 */
interface FakeBuilder {
  eq: () => FakeBuilder;
  contains: () => FakeBuilder;
  limit: () => FakeBuilder;
  then: (
    resolve: (value: { data: unknown[]; error: null }) => unknown
  ) => unknown;
}

vi.mock('@/lib/leads/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const builder: FakeBuilder = {
        eq: () => builder,
        contains: () => builder,
        limit: () => builder,
        then: (resolve) =>
          resolve({
            data:
              table === 'lead_settings' && fake.settingsRow
                ? [fake.settingsRow]
                : [],
            error: null,
          }),
      };
      return {
        select: () => builder,
        insert: (row: Record<string, unknown>) => {
          fake.inserts.push(row);
          return { select: () => ({ single: async () => row }) };
        },
      };
    },
  }),
}));

import { GET } from './route';

beforeEach(() => {
  fake.inserts.length = 0;
  fake.settingsRow = {
    account_id: 'acc-1',
    capture_key: 'key-1',
    enabled: true,
    allowed_hosts: [],
    links: [
      {
        code: 'a7x9k2m4',
        label: 'Anúncio Verão',
        destination: 'wa:5511999999999',
        message: 'Olá! Tenho interesse no anúncio.',
        created_at: '2026-10-29T12:00:00.000Z',
      },
    ],
  };
});

function request(url: string) {
  return new Request(url);
}

describe('GET /r/[code]', () => {
  it('answers 404 for an unknown code', async () => {
    fake.settingsRow = null;
    const res = await GET(request('https://crm.example.com/r/zzzzzzzz'), {
      params: Promise.resolve({ code: 'zzzzzzzz' }),
    });
    expect(res.status).toBe(404);
    expect(fake.inserts).toHaveLength(0);
  });

  it('creates one pending origin per click', async () => {
    await GET(request('https://crm.example.com/r/a7x9k2m4?utm_source=instagram'), {
      params: Promise.resolve({ code: 'a7x9k2m4' }),
    });
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0].contact_id).toBeNull();
    expect(fake.inserts[0].link_code).toBe('a7x9k2m4');
    expect(fake.inserts[0].landing_path).toBe('/r/a7x9k2m4');
    expect(fake.inserts[0].utm_source).toBe('instagram');
  });

  it('gives every click its own token', async () => {
    await GET(request('https://crm.example.com/r/a7x9k2m4'), {
      params: Promise.resolve({ code: 'a7x9k2m4' }),
    });
    await GET(request('https://crm.example.com/r/a7x9k2m4'), {
      params: Promise.resolve({ code: 'a7x9k2m4' }),
    });
    expect(fake.inserts[0].lead_token).not.toBe(fake.inserts[1].lead_token);
  });

  it('redirects to wa.me with the code in the message', async () => {
    const res = await GET(request('https://crm.example.com/r/a7x9k2m4'), {
      params: Promise.resolve({ code: 'a7x9k2m4' }),
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('https://wa.me/5511999999999');
    expect(location).toContain('ref+');
    expect(location).toContain(fake.inserts[0].lead_token);
  });

  it('sets the first-touch cookie', async () => {
    const res = await GET(request('https://crm.example.com/r/a7x9k2m4'), {
      params: Promise.resolve({ code: 'a7x9k2m4' }),
    });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('crmbr_oid=');
    expect(cookie).toContain('Max-Age=2592000');
    // Next.js serializes the attribute value in lower case; the
    // attribute itself is case-insensitive on the wire.
    expect(cookie.toLowerCase()).toContain('samesite=lax');
  });

  it('redirects to a url destination, keeping the utm parameters', async () => {
    fake.settingsRow = {
      ...(fake.settingsRow as Record<string, unknown>),
      links: [
        {
          code: 'a7x9k2m4',
          label: 'Site',
          destination: 'url:https://site.example.com/oferta',
          message: '',
          created_at: '2026-10-29T12:00:00.000Z',
        },
      ],
    };
    const res = await GET(
      request(
        'https://crm.example.com/r/a7x9k2m4?utm_source=instagram&utm_campaign=verao'
      ),
      { params: Promise.resolve({ code: 'a7x9k2m4' }) }
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('https://site.example.com/oferta');
    expect(location).toContain('utm_source=instagram');
    expect(location).toContain('utm_campaign=verao');
  });

  it('never redirects to an unknown destination scheme', async () => {
    fake.settingsRow = {
      ...(fake.settingsRow as Record<string, unknown>),
      links: [
        {
          code: 'a7x9k2m4',
          label: 'Bad',
          destination: 'javascript:alert(1)',
          message: '',
          created_at: '2026-10-29T12:00:00.000Z',
        },
      ],
    };
    const res = await GET(request('https://crm.example.com/r/a7x9k2m4'), {
      params: Promise.resolve({ code: 'a7x9k2m4' }),
    });
    expect(res.status).toBe(404);
  });
});
