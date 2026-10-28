import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';
import { ProviderError } from './errors';
import { resolveProviderConnection } from './connection';

/**
 * Fake supabase-js: `whatsmiau_config` resolves through maybeSingle(),
 * `whatsapp_config` (Meta) through single().
 *
 * The CRMBR row is only returned when it is the ACTIVE one — that is
 * the flag the dispatcher looks at to decide which provider wins.
 */
function fakeDb(opts: { whatsmiau?: unknown; meta?: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => {
      const row = opts.whatsmiau as { is_active?: boolean } | null | undefined;
      const active = row && row.is_active !== false;
      return Promise.resolve({ data: active ? row : null, error: null });
    },
    single: () => Promise.resolve({ data: opts.meta ?? null, error: null }),
    update: () => chain,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

const metaRow = {
  account_id: 'acc-1',
  phone_number_id: 'pn-1',
  access_token: encrypt('meta-token'),
};

const whatsmiauRow = {
  id: 'wm-1',
  account_id: 'acc-1',
  instance_name: 'Atendimento 01',
  provider_instance_name: 'studio_bella_atendimento_01',
  status: 'connected',
  is_active: true,
  instance_settings: {},
};

describe('resolveProviderConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The provider credential belongs to the platform and lives in the
    // server's environment — never in the database and never in the
    // customer's hands.
    vi.stubEnv('WHATSMIAU_API_KEY', 'platform-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers the CRMBR provider when it is active', async () => {
    const conn = await resolveProviderConnection(
      fakeDb({ whatsmiau: whatsmiauRow, meta: metaRow }),
      'acc-1',
    );
    expect(conn).toEqual({
      provider: 'whatsmiau',
      // The PROVIDER-side name — the namespaced one.
      instanceName: 'studio_bella_atendimento_01',
      apiKey: 'platform-key',
      baseUrl: 'https://api.whatsmiau.dev/v2',
    });
  });

  it('reads the provider base URL from the environment when it is set', async () => {
    vi.stubEnv('WHATSMIAU_BASE_URL', 'https://crmbr.example/v2/');
    const conn = await resolveProviderConnection(
      fakeDb({ whatsmiau: whatsmiauRow, meta: metaRow }),
      'acc-1',
    );
    expect(conn).toMatchObject({ baseUrl: 'https://crmbr.example/v2' });
  });

  it('falls back to Meta when the CRMBR provider is not active', async () => {
    const conn = await resolveProviderConnection(
      fakeDb({ whatsmiau: { ...whatsmiauRow, is_active: false }, meta: metaRow }),
      'acc-1',
    );
    expect(conn).toEqual({
      provider: 'meta',
      phoneNumberId: 'pn-1',
      accessToken: 'meta-token',
    });
  });

  it('uses Meta when there is no CRMBR row at all', async () => {
    const conn = await resolveProviderConnection(fakeDb({ meta: metaRow }), 'acc-1');
    expect(conn.provider).toBe('meta');
  });

  it('fails when the CRMBR provider is active but disconnected — never falls back to Meta', async () => {
    await expect(
      resolveProviderConnection(
        fakeDb({ whatsmiau: { ...whatsmiauRow, status: 'disconnected' }, meta: metaRow }),
        'acc-1',
      ),
    ).rejects.toBeInstanceOf(ProviderError);

    await resolveProviderConnection(
      fakeDb({ whatsmiau: { ...whatsmiauRow, status: 'disconnected' }, meta: metaRow }),
      'acc-1',
    ).catch((e: ProviderError) => {
      expect(e.code).toBe('provider_not_connected');
      expect(e.status).toBe(400);
      expect(e.message).not.toMatch(/meta/i);
    });
  });

  it('fails when neither provider is configured', async () => {
    await resolveProviderConnection(fakeDb({}), 'acc-1').catch((e: ProviderError) => {
      expect(e.code).toBe('whatsapp_not_configured');
      expect(e.status).toBe(400);
    });
  });
});
