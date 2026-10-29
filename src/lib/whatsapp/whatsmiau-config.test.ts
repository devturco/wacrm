import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_INSTANCE_SETTINGS,
  clearActiveWhatsmiauConfig,
  deleteWhatsmiauConfig,
  generateWebhookSecret,
  isProviderInstanceNameTaken,
  loadActiveWhatsmiauConfig,
  loadWhatsmiauConfigByInstanceName,
  loadWhatsmiauConfigByWebhookSecret,
  loadWhatsmiauConfigs,
  mergeInstanceSettings,
  setActiveWhatsmiauConfig,
  updateWhatsmiauConfigById,
  upsertWhatsmiauConfig,
} from './whatsmiau-config';

/**
 * Minimal fake of the supabase-js query builder for the shapes this
 * module uses: `.select().eq().maybeSingle()` on the read path,
 * `.order()`/`.limit()` on the list path and
 * `.update()/insert()/delete().select().single()` on the write path.
 *
 * `calls` records which write method was used; `tables` records the
 * table each query went to, so a typo'd table name cannot pass.
 */
function fakeDb(
  row: Record<string, unknown> | null,
  insertResult?: Record<string, unknown>,
) {
  const state = {
    selected: row,
    inserted: insertResult ?? row,
    rows: row ? [row] : ([] as Record<string, unknown>[]),
    calls: [] as string[],
    tables: [] as string[],
    payloads: [] as Record<string, unknown>[],
  };

  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: state.selected, error: null }),
    single: () => Promise.resolve({ data: state.inserted, error: null }),
    insert: (payload: Record<string, unknown>) => {
      state.calls.push('insert');
      state.payloads.push(payload);
      return chain;
    },
    update: (payload: Record<string, unknown>) => {
      state.calls.push('update');
      state.payloads.push(payload);
      return chain;
    },
    delete: () => {
      state.calls.push('delete');
      return chain;
    },
    // The list path awaits the builder itself.
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: state.rows, error: null }).then(resolve, reject),
  };

  return {
    db: {
      from: (table: string) => {
        state.tables.push(table);
        return chain;
      },
    } as unknown as SupabaseClient,
    state,
  };
}

const ROW = {
  id: 'wm-1',
  account_id: 'acc-1',
  instance_name: 'Atendimento 01',
  provider_instance_name: 'studio_bella_atendimento_01',
  webhook_secret: 'secret-1',
  status: 'connected',
  phone_number: '5511999999999',
  wuid: '99999',
  is_active: true,
  instance_settings: DEFAULT_INSTANCE_SETTINGS,
  connected_at: '2026-10-01T00:00:00.000Z',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

describe('whatsmiau config — defaults', () => {
  it('ships readMessages off and groupsIgnore on', () => {
    expect(DEFAULT_INSTANCE_SETTINGS.readMessages).toBe(false);
    expect(DEFAULT_INSTANCE_SETTINGS.groupsIgnore).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.rejectCall).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.saveMedia).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.webhook.base64).toBe(false);
    // A channel is a broadcast feed, not a customer — it stays out of
    // the inbox until the account asks for it.
    expect(DEFAULT_INSTANCE_SETTINGS.channelsEnabled).toBe(false);
  });

  it('merges a patch over the defaults without dropping untouched keys', () => {
    const merged = mergeInstanceSettings(null, { readMessages: true });
    expect(merged.readMessages).toBe(true);
    expect(merged.alwaysOnline).toBe(false);
    expect(merged.webhook.events).toEqual(DEFAULT_INSTANCE_SETTINGS.webhook.events);
  });

  it('merges a webhook patch over the current webhook', () => {
    const current = {
      ...DEFAULT_INSTANCE_SETTINGS,
      webhook: { ...DEFAULT_INSTANCE_SETTINGS.webhook, url: 'https://a.example/hook' },
    };
    const merged = mergeInstanceSettings(current, {
      webhook: { ...current.webhook, enabled: false },
    } as Partial<typeof DEFAULT_INSTANCE_SETTINGS>);
    expect(merged.webhook.url).toBe('https://a.example/hook');
    expect(merged.webhook.enabled).toBe(false);
  });

  it('never shares a mutable member with the module-level default', () => {
    const first = mergeInstanceSettings(null, {});
    const second = mergeInstanceSettings(null, {});

    expect(first.webhook.events).not.toBe(DEFAULT_INSTANCE_SETTINGS.webhook.events);
    expect(first.webhook.headers).not.toBe(DEFAULT_INSTANCE_SETTINGS.webhook.headers);
    expect(second.webhook.events).not.toBe(first.webhook.events);
    expect(second.webhook.headers).not.toBe(first.webhook.headers);

    // Mutating one account's settings must not leak into the default
    // nor into another account's settings.
    first.webhook.events.push('messages.upsert.LEAKED');
    first.webhook.headers.Authorization = 'leaked';

    expect(DEFAULT_INSTANCE_SETTINGS.webhook.events).not.toContain('messages.upsert.LEAKED');
    expect(DEFAULT_INSTANCE_SETTINGS.webhook.headers).toEqual({});
    expect(second.webhook.events).not.toContain('messages.upsert.LEAKED');
    expect(second.webhook.headers).toEqual({});
  });
});

describe('whatsmiau config — read', () => {
  it('lists every instance of the account', async () => {
    const { db } = fakeDb(ROW);
    const rows = await loadWhatsmiauConfigs(db, 'acc-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].instance_name).toBe('Atendimento 01');
  });

  it('resolves a row by instance name', async () => {
    const { db } = fakeDb(ROW);
    const row = await loadWhatsmiauConfigByInstanceName(db, 'acc-1', 'Atendimento 01');
    expect(row?.account_id).toBe('acc-1');
  });

  it('returns null for an empty instance name', async () => {
    const { db } = fakeDb(ROW);
    await expect(
      loadWhatsmiauConfigByInstanceName(db, 'acc-1', ''),
    ).resolves.toBeNull();
  });

  it('resolves the active row', async () => {
    const { db } = fakeDb(ROW);
    const row = await loadActiveWhatsmiauConfig(db, 'acc-1');
    expect(row?.is_active).toBe(true);
  });

  it('resolves a row by webhook secret', async () => {
    const { db } = fakeDb(ROW);
    const row = await loadWhatsmiauConfigByWebhookSecret(db, 'secret-1');
    expect(row?.account_id).toBe('acc-1');
  });

  it('returns null for an empty webhook secret', async () => {
    const { db } = fakeDb(ROW);
    await expect(
      loadWhatsmiauConfigByWebhookSecret(db, ''),
    ).resolves.toBeNull();
  });

  it('queries the whatsmiau_config table', async () => {
    const { db, state } = fakeDb(ROW);
    await loadWhatsmiauConfigs(db, 'acc-1');
    await loadWhatsmiauConfigByInstanceName(db, 'acc-1', 'Atendimento 01');
    await loadActiveWhatsmiauConfig(db, 'acc-1');
    await loadWhatsmiauConfigByWebhookSecret(db, 'secret-1');
    expect(state.tables).toEqual([
      'whatsmiau_config',
      'whatsmiau_config',
      'whatsmiau_config',
      'whatsmiau_config',
    ]);
  });
});

describe('whatsmiau config — write', () => {
  it('inserts the first row and returns it', async () => {
    const { db, state } = fakeDb(null, ROW);
    const row = await upsertWhatsmiauConfig(db, 'acc-1', {
      instance_name: 'Atendimento 01',
      provider_instance_name: 'studio_bella_atendimento_01',
    });
    expect(row.id).toBe('wm-1');
    expect(state.calls).toContain('insert');
    expect(state.inserted).toBeTruthy();
  });

  it('updates the existing row instead of inserting a second one', async () => {
    const { db, state } = fakeDb(ROW, { ...ROW, status: 'connecting' });
    const row = await upsertWhatsmiauConfig(db, 'acc-1', {
      instance_name: 'Atendimento 01',
      status: 'connecting',
    });
    expect(state.calls).toContain('update');
    expect(state.calls).not.toContain('insert');
    expect(row.status).toBe('connecting');
  });

  it('refuses to create a row without the provider instance name', async () => {
    const { db, state } = fakeDb(null, ROW);
    await expect(
      upsertWhatsmiauConfig(db, 'acc-1', { instance_name: 'Atendimento 01' }),
    ).rejects.toThrow(/provider instance name/i);
    expect(state.calls).not.toContain('insert');
  });

  it('refuses to create a row without an instance name', async () => {
    const { db, state } = fakeDb(null, ROW);
    await expect(
      upsertWhatsmiauConfig(db, 'acc-1', {
        provider_instance_name: 'studio_bella_atendimento_01',
      }),
    ).rejects.toThrow(/instance name/i);
    expect(state.calls).not.toContain('insert');
  });

  it('generates a webhook secret when the caller does not bring one', async () => {
    const { db, state } = fakeDb(null, ROW);
    await upsertWhatsmiauConfig(db, 'acc-1', {
      instance_name: 'Atendimento 01',
      provider_instance_name: 'studio_bella_atendimento_01',
    });
    const payload = state.payloads.at(-1)!;
    expect(payload.webhook_secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('updates a row by id', async () => {
    const { db, state } = fakeDb(ROW, { ...ROW, status: 'disconnected' });
    const row = await updateWhatsmiauConfigById(db, 'wm-1', {
      status: 'disconnected',
    });
    expect(state.calls).toContain('update');
    expect(row?.status).toBe('disconnected');
  });

  it('deletes a row', async () => {
    const { db, state } = fakeDb(ROW);
    await deleteWhatsmiauConfig(db, 'acc-1', 'Atendimento 01');
    expect(state.calls).toContain('delete');
  });

  it('clears the other rows before activating one', async () => {
    const { db, state } = fakeDb(ROW, { ...ROW, is_active: true });
    const row = await setActiveWhatsmiauConfig(db, 'acc-1', 'Atendimento 01');
    // One update clears the siblings, one sets the flag.
    expect(state.calls.filter((call) => call === 'update')).toHaveLength(2);
    expect(row?.is_active).toBe(true);
  });

  it('does not activate an instance the account does not own', async () => {
    const { db, state } = fakeDb(null);
    await expect(
      setActiveWhatsmiauConfig(db, 'acc-1', 'Someone else'),
    ).resolves.toBeNull();
    expect(state.calls).not.toContain('update');
  });

  it('clears the active connection', async () => {
    const { db, state } = fakeDb(ROW);
    await clearActiveWhatsmiauConfig(db, 'acc-1');
    expect(state.calls).toContain('update');
  });
});

describe('whatsmiau config — provider names', () => {
  it('reports a provider name that is already taken', async () => {
    const { db } = fakeDb(ROW);
    await expect(
      isProviderInstanceNameTaken(db, 'studio_bella_atendimento_01'),
    ).resolves.toBe(true);
  });

  it('reports a free provider name', async () => {
    const { db } = fakeDb(null);
    await expect(
      isProviderInstanceNameTaken(db, 'studio_bella_atendimento_01'),
    ).resolves.toBe(false);
  });
});

describe('whatsmiau config — secrets', () => {
  it('generates a 64-char hex webhook secret', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generateWebhookSecret()).not.toBe(secret);
  });
});
