// ============================================================
// CRMBR (WhatsMiau) account configuration.
//
// One row per account (`UNIQUE (account_id)`) holding the api key
// (encrypted), the instance name, the API base URL, the webhook
// shared secret and the instance-level behaviour flags.
//
// `whatsapp_config` — the Meta row — is deliberately NOT touched:
// upstream reads it with .single() per account, and a second row
// there would break the whole app.
// ============================================================

import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import {
  DEFAULT_INSTANCE_SETTINGS,
  type WhatsmiauInstanceSettings,
  type WhatsmiauStatus,
  type WhatsmiauWebhookConfig,
} from '@/lib/whatsapp/providers/whatsmiau/settings';

// The types and the defaults live in a dependency-free module so the
// settings screen (a client component) can import them without
// dragging `node:crypto` into the browser bundle. Re-exported here so
// every server-side import keeps working unchanged.
export {
  DEFAULT_INSTANCE_SETTINGS,
  type WhatsmiauInstanceSettings,
  type WhatsmiauStatus,
  type WhatsmiauWebhookConfig,
};

export interface WhatsmiauConfigRow {
  id: string;
  account_id: string;
  instance_name: string;
  api_key_encrypted: string;
  base_url: string;
  webhook_secret: string;
  status: WhatsmiauStatus;
  phone_number: string | null;
  wuid: string | null;
  is_active: boolean;
  instance_settings: WhatsmiauInstanceSettings;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsmiauConfigPatch {
  instance_name?: string;
  api_key_encrypted?: string;
  base_url?: string;
  webhook_secret?: string;
  status?: WhatsmiauStatus;
  phone_number?: string | null;
  wuid?: string | null;
  is_active?: boolean;
  connected_at?: string | null;
  instance_settings?: Partial<WhatsmiauInstanceSettings>;
}

/**
 * Overlay a patch over the current settings, keeping every key the
 * patch does not mention. A partial webhook patch keeps the current
 * webhook's url/headers/events — the WhatsMiau `PUT /instance/update`
 * route merges server-side, but our stored row must stay complete.
 *
 * The mutable members (`webhook.events`, `webhook.headers`) are
 * COPIED, never shared with `DEFAULT_INSTANCE_SETTINGS`: the default
 * is a module-level singleton, and a consumer that mutated a merged
 * result in place would otherwise corrupt it for every other account
 * in the process.
 */
export function mergeInstanceSettings(
  current: Partial<WhatsmiauInstanceSettings> | null | undefined,
  patch: Partial<WhatsmiauInstanceSettings>,
): WhatsmiauInstanceSettings {
  const base: WhatsmiauInstanceSettings = {
    ...DEFAULT_INSTANCE_SETTINGS,
    ...(current ?? {}),
    webhook: {
      ...DEFAULT_INSTANCE_SETTINGS.webhook,
      ...(current?.webhook ?? {}),
    },
  };
  const next: WhatsmiauInstanceSettings = { ...base, ...patch };
  next.webhook = {
    ...base.webhook,
    ...(patch.webhook ?? {}),
  };
  next.webhook.events = [...next.webhook.events];
  next.webhook.headers = { ...next.webhook.headers };
  return next;
}

/**
 * Normalise a raw row into a `WhatsmiauConfigRow`: the stored JSONB
 * may be missing keys the current shape has, so the defaults fill
 * them in.
 */
function toConfigRow(raw: WhatsmiauConfigRow): WhatsmiauConfigRow {
  return {
    ...raw,
    instance_settings: mergeInstanceSettings(raw.instance_settings, {}),
  };
}

/**
 * Read the account's CRMBR row, or null when the account never
 * configured the non-official API.
 */
export async function loadWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsmiauConfigRow | null> {
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * Resolve the account that owns a WhatsMiau instance name.
 *
 * NOTE: the instance name is NOT unique across accounts — two
 * companies may name their instance the same way — so this lookup is
 * only unambiguous while at most one row matches. The inbound webhook
 * routes by the webhook secret instead (see
 * `loadWhatsmiauConfigByWebhookSecret`); this helper stays for
 * lookups that are already account-scoped.
 */
export async function loadWhatsmiauConfigByInstanceName(
  db: SupabaseClient,
  instanceName: string,
): Promise<WhatsmiauConfigRow | null> {
  if (!instanceName) return null;
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('instance_name', instanceName)
    .maybeSingle();
  if (error || !data) return null;
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * Resolve the account that owns a webhook secret.
 *
 * The secret is 32 random bytes, generated once per account row, and
 * it is what the provider sends back as `Authorization: Bearer
 * <secret>`. That makes it the ONLY routing key that identifies an
 * account unambiguously: the instance name is chosen by the customer
 * and two accounts may well pick the same one.
 */
export async function loadWhatsmiauConfigByWebhookSecret(
  db: SupabaseClient,
  secret: string,
): Promise<WhatsmiauConfigRow | null> {
  if (!secret) return null;
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('webhook_secret', secret)
    .maybeSingle();
  if (error || !data) return null;
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * Insert or update the account's CRMBR row. The api key is stored
 * encrypted; callers pass the ciphertext, never the plaintext.
 */
export async function upsertWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
  patch: WhatsmiauConfigPatch,
): Promise<WhatsmiauConfigRow> {
  const current = await loadWhatsmiauConfig(db, accountId);

  const payload: Record<string, unknown> = {
    account_id: accountId,
    updated_at: new Date().toISOString(),
  };
  if (patch.instance_name !== undefined) payload.instance_name = patch.instance_name;
  if (patch.api_key_encrypted !== undefined) payload.api_key_encrypted = patch.api_key_encrypted;
  if (patch.base_url !== undefined) payload.base_url = patch.base_url;
  if (patch.webhook_secret !== undefined) payload.webhook_secret = patch.webhook_secret;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.phone_number !== undefined) payload.phone_number = patch.phone_number;
  if (patch.wuid !== undefined) payload.wuid = patch.wuid;
  if (patch.is_active !== undefined) payload.is_active = patch.is_active;
  if (patch.connected_at !== undefined) payload.connected_at = patch.connected_at;
  if (patch.instance_settings !== undefined) {
    payload.instance_settings = mergeInstanceSettings(
      current?.instance_settings,
      patch.instance_settings,
    );
  }

  // UPDATE-then-INSERT, not a single `upsert`.
  //
  // `INSERT ... ON CONFLICT (account_id) DO UPDATE` would be the shorter
  // spelling, but Postgres evaluates the NOT NULL constraints of the
  // INSERT branch BEFORE it resolves the conflict — so a partial patch
  // (say, only `status`) aborts with "null value in column
  // api_key_encrypted violates not-null constraint" instead of updating
  // the existing row. An UPDATE never trips that: it only touches the
  // columns we name.
  if (current) {
    const { data, error } = await db
      .from('whatsmiau_config')
      .update(payload)
      .eq('account_id', accountId)
      .select()
      .single();
    if (error || !data) {
      throw new Error(`Failed to save the WhatsMiau configuration: ${error?.message ?? 'unknown error'}`);
    }
    return toConfigRow(data as WhatsmiauConfigRow);
  }

  // No row yet — this is a first save, so every NOT NULL column has to
  // be present. Writing an empty string instead would satisfy the
  // constraint while producing a row whose api key can never be
  // decrypted — the failure would only surface at send time, far from
  // the cause. Refuse instead.
  if (!patch.api_key_encrypted) {
    throw new Error('WhatsMiau api key is required to create the configuration');
  }
  if (!patch.instance_name) {
    throw new Error('WhatsMiau instance name is required to create the configuration');
  }

  const insertPayload: Record<string, unknown> = {
    ...payload,
    instance_name: patch.instance_name,
    api_key_encrypted: patch.api_key_encrypted,
    webhook_secret: patch.webhook_secret ?? generateWebhookSecret(),
    instance_settings:
      payload.instance_settings ??
      mergeInstanceSettings(null, patch.instance_settings ?? {}),
  };

  const { data, error } = await db
    .from('whatsmiau_config')
    .insert(insertPayload)
    .select()
    .single();
  if (error || !data) {
    throw new Error(`Failed to save the WhatsMiau configuration: ${error?.message ?? 'unknown error'}`);
  }
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * Decrypt the stored api key.
 *
 * The column holds AES-GCM ciphertext produced by `encryption.ts`.
 * The table is new, so every row was written in GCM format — there is
 * no legacy CBC row to migrate. `decrypt()` reads both formats anyway,
 * so a hand-edited row still fails loudly instead of silently.
 */
export function decryptWhatsmiauApiKey(row: WhatsmiauConfigRow): string {
  return decrypt(row.api_key_encrypted);
}

/** Encrypt a plaintext api key for storage. */
export function encryptWhatsmiauApiKey(apiKey: string): string {
  return encrypt(apiKey);
}

/** 32 random bytes, hex — the webhook shared secret. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
