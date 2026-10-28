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

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';

export type WhatsmiauStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WhatsmiauWebhookConfig {
  enabled: boolean;
  url: string;
  headers: Record<string, string>;
  events: string[];
  base64: boolean;
}

export interface WhatsmiauInstanceSettings {
  alwaysOnline: boolean;
  readMessages: boolean;
  rejectCall: boolean;
  msgCall: string;
  groupsIgnore: boolean;
  saveMedia: boolean;
  webhook: WhatsmiauWebhookConfig;
}

export const DEFAULT_INSTANCE_SETTINGS: WhatsmiauInstanceSettings = {
  alwaysOnline: false,
  readMessages: false,
  rejectCall: true,
  msgCall: '',
  groupsIgnore: true,
  saveMedia: true,
  webhook: {
    enabled: true,
    url: '',
    headers: {},
    events: [
      'messages.upsert',
      'messages.edited',
      'messages.update',
      'messages.delete',
      'connection.update',
    ],
    base64: false,
  },
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
  return next;
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
  return {
    ...(data as WhatsmiauConfigRow),
    instance_settings: mergeInstanceSettings(
      data.instance_settings,
      (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
    ),
  };
}

/**
 * Resolve the account that owns a WhatsMiau instance name. Used by the
 * inbound webhook, which only knows the instance name.
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
  return {
    ...(data as WhatsmiauConfigRow),
    instance_settings: mergeInstanceSettings(
      data.instance_settings,
      (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
    ),
  };
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
    return {
      ...(data as WhatsmiauConfigRow),
      instance_settings: mergeInstanceSettings(
        data.instance_settings,
        (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
      ),
    };
  }

  // No row yet — this is a first save, so every NOT NULL column has to
  // be present. The settings route always supplies the api key and the
  // instance name; the webhook secret is generated here when the caller
  // did not bring one.
  const insertPayload: Record<string, unknown> = {
    ...payload,
    instance_name: patch.instance_name ?? '',
    api_key_encrypted: patch.api_key_encrypted ?? '',
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
  return {
    ...(data as WhatsmiauConfigRow),
    instance_settings: mergeInstanceSettings(
      data.instance_settings,
      (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
    ),
  };
}

/**
 * Decrypt the stored api key.
 *
 * A legacy CBC ciphertext still decrypts (the encryption module reads
 * both formats), but it is unauthenticated — so a legacy row is
 * reported to the caller instead of being silently trusted. The next
 * save re-encrypts it in GCM format.
 */
export function decryptWhatsmiauApiKey(row: WhatsmiauConfigRow): string {
  const apiKey = decrypt(row.api_key_encrypted);
  if (isLegacyFormat(row.api_key_encrypted)) {
    console.warn(
      '[whatsmiau-config] legacy ciphertext detected — re-encrypt on next save',
    );
  }
  return apiKey;
}

/** Encrypt a plaintext api key for storage. */
export function encryptWhatsmiauApiKey(apiKey: string): string {
  return encrypt(apiKey);
}

/** 32 random bytes, hex — the webhook shared secret. */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
