// ============================================================
// CRMBR (WhatsMiau) — the account's connections.
//
// One row per INSTANCE, several rows per account: a company may run
// more than one connection ("Atendimento", "Atendimento 2"). Exactly
// one of them is the ACTIVE one — the one the app sends through.
//
// THERE IS NO API KEY HERE. The provider credential belongs to the
// platform and lives in the server's environment
// (`providers/whatsmiau/platform-credential.ts`). The customer never
// holds a key and never types one into the app.
//
// Two names per row:
//   - `instance_name` — the name the CUSTOMER chose;
//   - `provider_instance_name` — the name it carries on the provider
//     (`<company>_<instance>`). The provider's account is shared by
//     every subscriber, so the prefix is what keeps two companies
//     that picked the same name from colliding.
//
// `whatsapp_config` — the Meta row — is deliberately NOT touched:
// upstream reads it with .single() per account, and a second row
// there would break the whole app.
// ============================================================

import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
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
  /** The name the customer chose. */
  instance_name: string;
  /** The name it carries on the provider: `<company>_<instance>`. */
  provider_instance_name: string;
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
  provider_instance_name?: string;
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
 * Every instance the account owns.
 *
 * The customer-facing name is unique inside the account; the provider
 * name is unique everywhere.
 */
export async function loadWhatsmiauConfigs(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsmiauConfigRow[]> {
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as WhatsmiauConfigRow[]).map(toConfigRow);
}

/**
 * The account's OWN instance, by the name the customer gave it.
 *
 * Account-scoped on purpose: an instance that belongs to another
 * company resolves to null and the caller answers 404 — the customer
 * can never tell "not yours" from "does not exist".
 */
export async function loadWhatsmiauConfigByInstanceName(
  db: SupabaseClient,
  accountId: string,
  instanceName: string,
): Promise<WhatsmiauConfigRow | null> {
  if (!instanceName) return null;
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('instance_name', instanceName)
    .maybeSingle();
  if (error || !data) return null;
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * The account's ACTIVE instance — the one the app sends through.
 *
 * Null when the account never opted into the CRMBR API, or when the
 * instance that was active was deleted.
 */
export async function loadActiveWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsmiauConfigRow | null> {
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) return null;
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * Resolve the instance behind a webhook secret.
 *
 * The secret is 32 random bytes, generated once per instance, and it
 * is what the provider sends back as `Authorization: Bearer <secret>`.
 * That makes it the ONLY routing key that identifies an instance
 * unambiguously: the customer's name is chosen by the customer, and
 * two companies may well pick the same one.
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
 * Is this provider name already taken?
 *
 * `ownRowId` lets a caller ignore the row it is about to update.
 */
export async function isProviderInstanceNameTaken(
  db: SupabaseClient,
  providerInstanceName: string,
  ownRowId?: string,
): Promise<boolean> {
  if (!providerInstanceName) return false;
  let query = db
    .from('whatsmiau_config')
    .select('id')
    .eq('provider_instance_name', providerInstanceName);
  if (ownRowId) query = query.neq('id', ownRowId);
  const { data, error } = await query.limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Insert or update one of the account's instances.
 *
 * The row is keyed by `(account_id, instance_name)` — the name the
 * customer gave it. `provider_instance_name` is written once, at
 * creation: renaming it on the provider would orphan the WhatsApp
 * number.
 */
export async function upsertWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
  patch: WhatsmiauConfigPatch,
): Promise<WhatsmiauConfigRow> {
  const instanceName = patch.instance_name?.trim();
  const current = instanceName
    ? await loadWhatsmiauConfigByInstanceName(db, accountId, instanceName)
    : null;

  const payload: Record<string, unknown> = {
    account_id: accountId,
    updated_at: new Date().toISOString(),
  };
  if (instanceName) payload.instance_name = instanceName;
  if (patch.provider_instance_name !== undefined) {
    payload.provider_instance_name = patch.provider_instance_name;
  }
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
  // `INSERT ... ON CONFLICT (account_id, instance_name) DO UPDATE` would
  // be the shorter spelling, but Postgres evaluates the NOT NULL
  // constraints of the INSERT branch BEFORE it resolves the conflict —
  // so a partial patch (say, only `status`) aborts with "null value in
  // column provider_instance_name violates not-null constraint"
  // instead of updating the existing row. An UPDATE never trips that:
  // it only touches the columns we name.
  if (current) {
    const { data, error } = await db
      .from('whatsmiau_config')
      .update(payload)
      .eq('id', current.id)
      .select()
      .single();
    if (error || !data) {
      throw new Error(
        `Failed to save the WhatsMiau configuration: ${error?.message ?? 'unknown error'}`,
      );
    }
    return toConfigRow(data as WhatsmiauConfigRow);
  }

  // No row yet — this is a first save, so every NOT NULL column has to
  // be present. Writing an empty string instead would satisfy the
  // constraint while producing a row the provider could never be
  // reached through — the failure would only surface at send time, far
  // from the cause. Refuse instead.
  if (!patch.provider_instance_name) {
    throw new Error('The provider instance name is required to create the configuration');
  }
  if (!instanceName) {
    throw new Error('The instance name is required to create the configuration');
  }

  const insertPayload: Record<string, unknown> = {
    ...payload,
    instance_name: instanceName,
    provider_instance_name: patch.provider_instance_name,
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
    throw new Error(
      `Failed to save the WhatsMiau configuration: ${error?.message ?? 'unknown error'}`,
    );
  }
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * Update one row by its id.
 *
 * The right call when the row is already known — the inbound webhook
 * resolves it by secret and then only needs to move its status. The
 * by-name variant is for the routes, which address the instance the
 * way the customer named it.
 */
export async function updateWhatsmiauConfigById(
  db: SupabaseClient,
  rowId: string,
  patch: WhatsmiauConfigPatch,
): Promise<WhatsmiauConfigRow | null> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.instance_name !== undefined) payload.instance_name = patch.instance_name;
  if (patch.provider_instance_name !== undefined) {
    payload.provider_instance_name = patch.provider_instance_name;
  }
  if (patch.webhook_secret !== undefined) payload.webhook_secret = patch.webhook_secret;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.phone_number !== undefined) payload.phone_number = patch.phone_number;
  if (patch.wuid !== undefined) payload.wuid = patch.wuid;
  if (patch.is_active !== undefined) payload.is_active = patch.is_active;
  if (patch.connected_at !== undefined) payload.connected_at = patch.connected_at;
  if (patch.instance_settings !== undefined) {
    const { data: current, error: readError } = await db
      .from('whatsmiau_config')
      .select('instance_settings')
      .eq('id', rowId)
      .maybeSingle();
    if (readError) return null;
    payload.instance_settings = mergeInstanceSettings(
      (current as { instance_settings?: Partial<WhatsmiauInstanceSettings> } | null)
        ?.instance_settings,
      patch.instance_settings,
    );
  }

  const { data, error } = await db
    .from('whatsmiau_config')
    .update(payload)
    .eq('id', rowId)
    .select()
    .single();
  if (error || !data) return null;
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * Delete one of the account's instances.
 *
 * The provider-side instance is deleted by the route; this only
 * removes our row.
 */
export async function deleteWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
  instanceName: string,
): Promise<void> {
  const { error } = await db
    .from('whatsmiau_config')
    .delete()
    .eq('account_id', accountId)
    .eq('instance_name', instanceName);
  if (error) {
    throw new Error(
      `Failed to delete the WhatsMiau configuration: ${error?.message ?? 'unknown error'}`,
    );
  }
}

/**
 * Make one of the account's instances THE active one.
 *
 * The provider's account is shared, but only ONE instance per company
 * is ever in use — the database enforces it with a partial unique
 * index, so the previous one is cleared first.
 */
export async function setActiveWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
  instanceName: string,
): Promise<WhatsmiauConfigRow | null> {
  const row = await loadWhatsmiauConfigByInstanceName(db, accountId, instanceName);
  if (!row) return null;

  // Clear the others first: the partial unique index would reject the
  // update while two rows were active.
  const { error: clearError } = await db
    .from('whatsmiau_config')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .neq('id', row.id);
  if (clearError) {
    throw new Error(
      `Failed to switch the active instance: ${clearError.message ?? 'unknown error'}`,
    );
  }

  const { data, error } = await db
    .from('whatsmiau_config')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select()
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to activate the instance: ${error?.message ?? 'unknown error'}`,
    );
  }
  return toConfigRow(data as WhatsmiauConfigRow);
}

/**
 * Clear the account's active connection — the company went back to
 * the official Meta API.
 */
export async function clearActiveWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { error } = await db
    .from('whatsmiau_config')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('is_active', true);
  if (error) {
    throw new Error(
      `Failed to clear the active instance: ${error.message ?? 'unknown error'}`,
    );
  }
}

/** 32 random bytes, hex — the webhook shared secret. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
