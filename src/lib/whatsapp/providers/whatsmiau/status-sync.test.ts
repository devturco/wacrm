import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  state: null as unknown,
  stateError: null as unknown,
  active: null as unknown,
  metaStatus: null as string | null,
  activated: [] as string[],
  patches: [] as Record<string, unknown>[],
}));

vi.mock('./instances', () => ({
  getConnectionState: vi.fn(async () => {
    if (h.stateError) throw h.stateError;
    return h.state;
  }),
}));

vi.mock('@/lib/whatsapp/whatsmiau-config', () => ({
  loadActiveWhatsmiauConfig: vi.fn(async () => h.active),
  setActiveWhatsmiauConfig: vi.fn(
    async (_db: unknown, _accountId: string, instanceName: string) => {
      h.activated.push(instanceName);
      return null;
    },
  ),
  updateWhatsmiauConfigById: vi.fn(
    async (_db: unknown, _id: string, patch: Record<string, unknown>) => {
      h.patches.push(patch);
      return { ...row(), ...patch };
    },
  ),
}));

import { WhatsmiauApiError } from './client';
import { getConnectionState } from './instances';
import {
  activateIfOnlyUsableConnection,
  syncWhatsmiauStatus,
  syncWhatsmiauStatuses,
} from './status-sync';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wm-1',
    account_id: 'acc-1',
    instance_name: 'Atendimento 01',
    provider_instance_name: 'storm_thiago',
    webhook_secret: 'a'.repeat(64),
    status: 'connecting',
    phone_number: null,
    wuid: null,
    is_active: false,
    instance_settings: {
      alwaysOnline: false,
      readMessages: false,
      rejectCall: true,
      msgCall: '',
      groupsIgnore: true,
      saveMedia: true,
      webhook: { enabled: true, url: '', headers: {}, events: [], base64: false },
    },
    connected_at: null,
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T09:00:00Z',
    ...overrides,
  };
}

function dbDouble(): SupabaseClient {
  const api = {
    select: () => api,
    eq: () => api,
    maybeSingle: async () => ({
      data: h.metaStatus === null ? null : { status: h.metaStatus },
      error: null,
    }),
  };
  return { from: () => api } as unknown as SupabaseClient;
}

// The platform credential lives in the environment — the provider is
// never called in this test, but the connection object is built.
beforeEach(() => {
  vi.stubEnv('WHATSMIAU_API_KEY', 'platform-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('syncWhatsmiauStatus', () => {
  beforeEach(() => {
    h.state = null;
    h.stateError = null;
    h.active = null;
    h.metaStatus = null;
    h.activated = [];
    h.patches = [];
  });

  it('writes the provider state onto the row', async () => {
    h.state = {
      state: 'open',
      connected: true,
      suspended: false,
      wuid: '5511999988888@s.whatsapp.net',
    };

    const updated = await syncWhatsmiauStatus(dbDouble(), row() as never);

    expect(h.patches[0]).toMatchObject({
      status: 'connected',
      phone_number: '5511999988888',
      wuid: '5511999988888@s.whatsapp.net',
    });
    expect(updated.status).toBe('connected');
  });

  it('keeps the stored status when the provider cannot be reached', async () => {
    h.stateError = new Error('network down');

    const updated = await syncWhatsmiauStatus(dbDouble(), row() as never);

    expect(h.patches).toHaveLength(0);
    expect(updated.status).toBe('connecting');
  });

  it('marks the row disconnected when the instance is gone from the provider', async () => {
    h.stateError = new WhatsmiauApiError(
      404,
      'whatsmiau_not_found',
      'instance not found',
    );

    await syncWhatsmiauStatus(dbDouble(), row() as never);

    expect(h.patches[0]).toMatchObject({ status: 'disconnected' });
  });

  it('asks the provider with a deadline — a stuck provider cannot hold the screen', async () => {
    h.state = { state: 'open', connected: true, suspended: false };

    await syncWhatsmiauStatus(dbDouble(), row() as never);

    expect(getConnectionState).toHaveBeenCalledWith(
      expect.anything(),
      'storm_thiago',
      { timeoutMs: expect.any(Number) },
    );
  });
});

describe('activateIfOnlyUsableConnection', () => {
  beforeEach(() => {
    h.active = null;
    h.metaStatus = null;
    h.activated = [];
  });

  it('activates a paired connection when the account has nothing else', async () => {
    await activateIfOnlyUsableConnection(
      dbDouble(),
      'acc-1',
      row({ status: 'connected' }) as never,
    );

    expect(h.activated).toEqual(['Atendimento 01']);
  });

  it('leaves an account whose Meta API is connected alone', async () => {
    h.metaStatus = 'connected';

    await activateIfOnlyUsableConnection(
      dbDouble(),
      'acc-1',
      row({ status: 'connected' }) as never,
    );

    expect(h.activated).toHaveLength(0);
  });

  it('does not take the active slot from another connection', async () => {
    h.active = row({ instance_name: 'Atendimento 02', is_active: true });

    await activateIfOnlyUsableConnection(
      dbDouble(),
      'acc-1',
      row({ status: 'connected' }) as never,
    );

    expect(h.activated).toHaveLength(0);
  });

  it('does not activate a connection that is not paired', async () => {
    await activateIfOnlyUsableConnection(dbDouble(), 'acc-1', row() as never);

    expect(h.activated).toHaveLength(0);
  });
});

describe('syncWhatsmiauStatuses', () => {
  beforeEach(() => {
    h.state = null;
    h.stateError = null;
    h.active = null;
    h.metaStatus = null;
    h.activated = [];
    h.patches = [];
  });

  it('asks the provider only about the connections whose state is unsure', async () => {
    h.state = { state: 'open', connected: true, suspended: false };

    await syncWhatsmiauStatuses(dbDouble(), [
      row({ status: 'connected' }) as never,
      row({ id: 'wm-2', instance_name: 'Atendimento 02', status: 'connecting' }) as never,
    ]);

    // Only the second row was checked with the provider.
    expect(h.patches).toHaveLength(1);
    expect(h.patches[0]).toMatchObject({ status: 'connected' });
  });

  it('activates a connection that was paired before the webhook worked', async () => {
    await syncWhatsmiauStatuses(dbDouble(), [row({ status: 'connected' }) as never]);

    expect(h.activated).toEqual(['Atendimento 01']);
  });
});
