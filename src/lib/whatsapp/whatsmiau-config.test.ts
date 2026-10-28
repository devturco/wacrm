import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_INSTANCE_SETTINGS,
  decryptWhatsmiauApiKey,
  encryptWhatsmiauApiKey,
  generateWebhookSecret,
  loadWhatsmiauConfig,
  loadWhatsmiauConfigByInstanceName,
  mergeInstanceSettings,
  upsertWhatsmiauConfig,
} from './whatsmiau-config';

/**
 * Minimal fake of the supabase-js query builder for the three shapes
 * this module uses: `.select().eq().maybeSingle()` on the read path
 * and `.update()/insert().select().single()` on the write path.
 * `calls` records which write method was used.
 */
function fakeDb(row: Record<string, unknown> | null, insertResult?: Record<string, unknown>) {
  const state = {
    selected: row,
    inserted: insertResult ?? row,
    calls: [] as string[],
    payloads: [] as Record<string, unknown>[],
  };
  const chain = {
    select: () => chain,
    eq: () => chain,
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
  };
  return {
    db: { from: () => chain } as unknown as SupabaseClient,
    state,
  };
}

const ROW = {
  id: 'wm-1',
  account_id: 'acc-1',
  instance_name: 'Atendimento01',
  api_key_encrypted: 'enc',
  instance_settings: DEFAULT_INSTANCE_SETTINGS,
};

describe('whatsmiau config — defaults', () => {
  it('ships readMessages off and groupsIgnore on', () => {
    expect(DEFAULT_INSTANCE_SETTINGS.readMessages).toBe(false);
    expect(DEFAULT_INSTANCE_SETTINGS.groupsIgnore).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.rejectCall).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.saveMedia).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.webhook.base64).toBe(false);
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
});

describe('whatsmiau config — read', () => {
  it('returns null when the account has no row', async () => {
    const { db } = fakeDb(null);
    await expect(loadWhatsmiauConfig(db, 'acc-1')).resolves.toBeNull();
  });

  it('returns the row for the account', async () => {
    const { db } = fakeDb(ROW);
    const row = await loadWhatsmiauConfig(db, 'acc-1');
    expect(row?.instance_name).toBe('Atendimento01');
  });

  it('resolves a row by instance name', async () => {
    const { db } = fakeDb(ROW);
    const row = await loadWhatsmiauConfigByInstanceName(db, 'Atendimento01');
    expect(row?.account_id).toBe('acc-1');
  });

  it('returns null for an empty instance name', async () => {
    const { db } = fakeDb(ROW);
    await expect(loadWhatsmiauConfigByInstanceName(db, '')).resolves.toBeNull();
  });
});

describe('whatsmiau config — write', () => {
  it('inserts the first row and returns it', async () => {
    const { db, state } = fakeDb(null, ROW);
    const row = await upsertWhatsmiauConfig(db, 'acc-1', {
      instance_name: 'Atendimento01',
      api_key_encrypted: 'enc',
    });
    expect(row.id).toBe('wm-1');
    expect(state.calls).toContain('insert');
    expect(state.inserted).toBeTruthy();
  });

  it('updates the existing row instead of inserting a second one', async () => {
    const { db, state } = fakeDb(ROW, { ...ROW, status: 'connected' });
    const row = await upsertWhatsmiauConfig(db, 'acc-1', { status: 'connected' });
    expect(state.calls).toContain('update');
    expect(state.calls).not.toContain('insert');
    expect(row.status).toBe('connected');
  });

  it('generates a webhook secret when the caller does not bring one', async () => {
    const { db, state } = fakeDb(null, ROW);
    await upsertWhatsmiauConfig(db, 'acc-1', {
      instance_name: 'Atendimento01',
      api_key_encrypted: 'enc',
    });
    const payload = state.payloads.at(-1)!;
    expect(payload.webhook_secret).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('whatsmiau config — secrets', () => {
  it('generates a 64-char hex webhook secret', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generateWebhookSecret()).not.toBe(secret);
  });

  it('decrypts the stored api key', () => {
    const row = { api_key_encrypted: encryptWhatsmiauApiKey('super-secret') } as never;
    expect(decryptWhatsmiauApiKey(row)).toBe('super-secret');
  });

  it('never returns the raw ciphertext when the value is not encrypted', () => {
    const row = { api_key_encrypted: 'not-encrypted' } as never;
    expect(() => decryptWhatsmiauApiKey(row)).toThrow();
  });
});
