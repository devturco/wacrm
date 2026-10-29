import type { SupabaseClient } from '@supabase/supabase-js';

import type { LeadOriginStore } from './origin';
import type { CampaignLink, LeadOriginRow, LeadSettings } from './types';

/**
 * The Supabase implementation of the two stores.
 *
 * `lead_origins` is written by the service role only (there is no
 * write policy on the table), so every write here goes through a
 * client that bypasses RLS.
 */
export function createLeadOriginStore(db: SupabaseClient): LeadOriginStore {
  return {
    async findByToken(accountId, token) {
      const { data, error } = await db
        .from('lead_origins')
        .select('*')
        .eq('account_id', accountId)
        .eq('lead_token', token)
        .is('contact_id', null)
        .limit(1);
      if (error) throw error;
      return (data?.[0] as LeadOriginRow | undefined) ?? null;
    },

    async findPendingByPhone(accountId, phone, sinceIso) {
      const { data, error } = await db
        .from('lead_origins')
        .select('*')
        .eq('account_id', accountId)
        .eq('phone', phone)
        .is('contact_id', null)
        .gte('touched_at', sinceIso)
        .order('touched_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as LeadOriginRow | undefined) ?? null;
    },

    async findPrimaryByContact(accountId, contactId) {
      const { data, error } = await db
        .from('lead_origins')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('is_primary', true)
        .limit(1);
      if (error) throw error;
      return (data?.[0] as LeadOriginRow | undefined) ?? null;
    },

    async insertOrigin(input) {
      const { data, error } = await db
        .from('lead_origins')
        .insert(input)
        .select('*')
        .single();
      if (error) throw error;
      return data as LeadOriginRow;
    },

    async attachContact(originId, contactId) {
      const { error } = await db
        .from('lead_origins')
        .update({ contact_id: contactId, updated_at: new Date().toISOString() })
        .eq('id', originId);
      if (error) throw error;
    },

    async setPrimary(originId) {
      const { error } = await db
        .from('lead_origins')
        .update({ is_primary: true, updated_at: new Date().toISOString() })
        .eq('id', originId);
      // The partial unique index rejects a second primary for the same
      // contact — a concurrent inbound won the race, and the other
      // origin is the primary. Not an error.
      if (error && !/duplicate key|unique/i.test(error.message)) throw error;
      return true;
    },

    async isTokenTaken(accountId, token) {
      const { data, error } = await db
        .from('lead_origins')
        .select('id')
        .eq('account_id', accountId)
        .eq('lead_token', token)
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  };
}

/** The account's lead configuration. */
export interface LeadSettingsStore {
  read(accountId: string): Promise<LeadSettings | null>;
  create(accountId: string, captureKey: string): Promise<LeadSettings>;
  update(
    accountId: string,
    patch: Partial<LeadSettings>
  ): Promise<LeadSettings>;
  findByCaptureKey(captureKey: string): Promise<LeadSettings | null>;
  findByLinkCode(code: string): Promise<LeadSettings | null>;
}

function toSettings(row: Record<string, unknown>): LeadSettings {
  return {
    account_id: String(row.account_id),
    capture_key: String(row.capture_key),
    enabled: row.enabled === true,
    allowed_hosts: Array.isArray(row.allowed_hosts)
      ? (row.allowed_hosts as string[])
      : [],
    links: Array.isArray(row.links) ? (row.links as CampaignLink[]) : [],
  };
}

export function createLeadSettingsStore(db: SupabaseClient): LeadSettingsStore {
  const read = async (accountId: string): Promise<LeadSettings | null> => {
    const { data, error } = await db
      .from('lead_settings')
      .select('*')
      .eq('account_id', accountId)
      .limit(1);
    if (error) throw error;
    const row = data?.[0] as Record<string, unknown> | undefined;
    return row ? toSettings(row) : null;
  };

  return {
    read,

    async create(accountId, captureKey) {
      const { data, error } = await db
        .from('lead_settings')
        .insert({
          account_id: accountId,
          capture_key: captureKey,
          enabled: true,
          allowed_hosts: [],
          links: [],
        })
        .select('*')
        .single();
      if (error) throw error;
      return toSettings(data as Record<string, unknown>);
    },

    async update(accountId, patch) {
      const current = await read(accountId);

      // `capture_key` is NOT NULL with no default and Postgres
      // validates it BEFORE the ON CONFLICT branch runs — an upsert
      // that omits it fails even when the row already exists. The
      // current value always travels with the update; on the first
      // save there is no current value, so the patch has to bring one.
      const captureKey = patch.capture_key ?? current?.capture_key;
      if (!captureKey) throw new Error('Lead settings not found');

      const body: Record<string, unknown> = {
        account_id: accountId,
        capture_key: captureKey,
        updated_at: new Date().toISOString(),
      };
      if (patch.enabled !== undefined) body.enabled = patch.enabled;
      if (patch.allowed_hosts !== undefined)
        body.allowed_hosts = patch.allowed_hosts;
      if (patch.links !== undefined) body.links = patch.links;

      const { data, error } = await db
        .from('lead_settings')
        .upsert(body, { onConflict: 'account_id' })
        .select('*')
        .single();
      if (error) throw error;
      return toSettings(data as Record<string, unknown>);
    },

    async findByCaptureKey(captureKey) {
      const { data, error } = await db
        .from('lead_settings')
        .select('*')
        .eq('capture_key', captureKey)
        .limit(1);
      if (error) throw error;
      const row = data?.[0] as Record<string, unknown> | undefined;
      return row ? toSettings(row) : null;
    },

    async findByLinkCode(code) {
      // JSONB containment: an array contains an object when one of its
      // elements contains that object. `{"code":"a7x9"}` is contained
      // by the links array exactly when one link has that code.
      //
      // The value MUST be an object, not an array. supabase-js
      // serializes an array as `cs.{a,b}` — a Postgres ARRAY filter —
      // and `[{}].join(',')` is the string "[object Object]", which
      // Postgres rejects with "invalid input syntax for type json".
      // An object goes out as `cs.{"code":"a7x9"}`, the containment
      // Postgres understands on a JSONB column.
      const { data, error } = await db
        .from('lead_settings')
        .select('*')
        .contains('links', { code })
        .limit(1);
      if (error) throw error;
      const row = data?.[0] as Record<string, unknown> | undefined;
      return row ? toSettings(row) : null;
    },
  };
}
