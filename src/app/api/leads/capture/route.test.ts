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
  rateLimit: {
    success: true,
    remaining: 9,
    reset: 0,
    limit: 30,
  },
}));

/** The builder the store drives: `select().eq().limit()`. */
interface FakeBuilder {
  eq: () => FakeBuilder;
  limit: () => Promise<{ data: unknown[]; error: null }>;
}

vi.mock('@/lib/leads/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => {
        const builder: FakeBuilder = {
          eq: () => builder,
          limit: async () => ({
            data:
              table === 'lead_settings' && fake.settingsRow
                ? [fake.settingsRow]
                : [],
            error: null,
          }),
        };
        return builder;
      },
      insert: (row: Record<string, unknown>) => {
        fake.inserts.push(row);
        return { select: () => ({ single: async () => row }) };
      },
    }),
  }),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { leadCapture: { limit: 30, windowMs: 60_000 } },
  getClientIp: () => '203.0.113.7',
  checkRateLimit: () => fake.rateLimit,
  rateLimitResponse: () =>
    new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

import { POST } from './route';

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://crm.example.com/api/leads/capture', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-capture-key': 'key-1',
      origin: 'https://site.example.com',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const VALID = {
  action: 'form_submit',
  channel: 'web',
  phone: '+55 (11) 99999-9999',
  first: { utm_source: 'instagram', utm_campaign: 'verao' },
  now: { utm_source: 'instagram', utm_campaign: 'verao' },
};

beforeEach(() => {
  fake.inserts.length = 0;
  fake.rateLimit = {
    success: true,
    remaining: 9,
    reset: Date.now() + 60_000,
    limit: 30,
  };
  fake.settingsRow = {
    account_id: 'acc-1',
    capture_key: 'key-1',
    enabled: true,
    allowed_hosts: [],
    links: [],
  };
});

describe('POST /api/leads/capture', () => {
  it('answers 404 when the key is unknown', async () => {
    fake.settingsRow = null;
    const res = await POST(request(VALID));
    expect(res.status).toBe(404);
    expect(fake.inserts).toHaveLength(0);
  });

  it('answers 404 when the capture is disabled', async () => {
    fake.settingsRow = {
      ...(fake.settingsRow as Record<string, unknown>),
      enabled: false,
    };
    const res = await POST(request(VALID));
    expect(res.status).toBe(404);
  });

  it('answers 404 when the key header is missing', async () => {
    const res = await POST(request(VALID, { 'x-capture-key': '' }));
    expect(res.status).toBe(404);
  });

  it('answers 403 when the host is not on the allowlist', async () => {
    fake.settingsRow = {
      ...(fake.settingsRow as Record<string, unknown>),
      allowed_hosts: ['other.example.com'],
    };
    const res = await POST(request(VALID));
    expect(res.status).toBe(403);
    expect(fake.inserts).toHaveLength(0);
  });

  it('accepts a host on the allowlist', async () => {
    fake.settingsRow = {
      ...(fake.settingsRow as Record<string, unknown>),
      allowed_hosts: ['site.example.com'],
    };
    const res = await POST(request(VALID));
    expect(res.status).toBe(200);
  });

  it('answers 429 when the rate limit is exhausted', async () => {
    fake.rateLimit = {
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 30,
    };
    const res = await POST(request(VALID));
    expect(res.status).toBe(429);
    expect(fake.inserts).toHaveLength(0);
  });

  it('answers 400 for an invalid body', async () => {
    const res = await POST(request({ action: 'nope' }));
    expect(res.status).toBe(400);
    expect(fake.inserts).toHaveLength(0);
  });

  it('writes one pending origin when both touches are the same', async () => {
    const res = await POST(request(VALID));
    expect(res.status).toBe(200);
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0].contact_id).toBeNull();
    expect(fake.inserts[0].is_primary).toBe(false);
    expect(fake.inserts[0].utm_source).toBe('instagram');
  });

  it('writes two pending origins when the touches differ', async () => {
    const res = await POST(
      request({
        ...VALID,
        now: { utm_source: 'instagram', utm_campaign: 'inverno' },
      })
    );
    expect(res.status).toBe(200);
    expect(fake.inserts).toHaveLength(2);
  });

  it('normalizes the phone to digits', async () => {
    await POST(request(VALID));
    expect(fake.inserts[0].phone).toBe('5511999999999');
  });

  it('returns the lead token it wrote', async () => {
    const res = await POST(request(VALID));
    const body = (await res.json()) as { leadToken: string };
    expect(body.leadToken).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(fake.inserts[0].lead_token).toBe(body.leadToken);
  });

  it('puts the token on the FIRST touch, not the last one', async () => {
    const res = await POST(
      request({
        ...VALID,
        now: { utm_source: 'instagram', utm_campaign: 'inverno' },
      })
    );
    const body = (await res.json()) as { leadToken: string };
    expect(fake.inserts[0].lead_token).toBe(body.leadToken);
    expect(fake.inserts[1].lead_token).toBeNull();
  });
});
