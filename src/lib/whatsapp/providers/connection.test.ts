import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';
import { ProviderError } from './errors';
import { resolveProviderConnection } from './connection';

/**
 * Fake supabase-js: `whatsmiau_config` resolves through maybeSingle(),
 * `whatsapp_config` (Meta) through single().
 */
function fakeDb(opts: { whatsmiau?: unknown; meta?: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({ data: opts.whatsmiau ?? null, error: null }),
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
  instance_name: 'Atendimento01',
  api_key_encrypted: encrypt('wm-key'),
  base_url: 'https://api.whatsmiau.dev/v2',
  status: 'connected',
  is_active: true,
  instance_settings: {},
};

describe('resolveProviderConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the CRMBR provider when it is active', async () => {
    const conn = await resolveProviderConnection(
      fakeDb({ whatsmiau: whatsmiauRow, meta: metaRow }),
      'acc-1',
    );
    expect(conn).toEqual({
      provider: 'whatsmiau',
      instanceName: 'Atendimento01',
      apiKey: 'wm-key',
      baseUrl: 'https://api.whatsmiau.dev/v2',
    });
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
