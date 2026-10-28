// ============================================================
// Which provider is this account sending through?
//
// One active provider per account. The CRMBR (WhatsMiau) provider
// wins when its row is active; otherwise Meta is used.
//
// There is deliberately NO fallback from an active-but-disconnected
// CRMBR provider back to Meta: sending the customer's message from
// the wrong number is worse than failing loudly.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import {
  decryptWhatsmiauApiKey,
  loadWhatsmiauConfig,
  type WhatsmiauConfigRow,
} from '@/lib/whatsapp/whatsmiau-config';
import { ProviderError } from './errors';
import type { ProviderConnection, WhatsmiauConnection } from './types';

/**
 * Build a WhatsMiau connection from a stored config row.
 *
 * The CRMBR management routes (list instances, fetch the QR code, push
 * the webhook config) talk to the provider directly instead of going
 * through the send path, so they need the same connection object the
 * dispatcher would build.
 */
export function whatsmiauConnectionFromConfig(
  row: WhatsmiauConfigRow,
): WhatsmiauConnection {
  return {
    provider: 'whatsmiau',
    instanceName: row.instance_name,
    apiKey: decryptWhatsmiauApiKey(row),
    baseUrl: row.base_url,
  };
}

export async function resolveProviderConnection(
  db: SupabaseClient,
  accountId: string,
): Promise<ProviderConnection> {
  const whatsmiau = await loadWhatsmiauConfig(db, accountId);

  if (whatsmiau?.is_active) {
    if (whatsmiau.status !== 'connected') {
      throw new ProviderError(
        'provider_not_connected',
        'The CRMBR (non-official) API is selected but the WhatsApp number is not connected. Finish pairing it in Settings → WhatsApp → CRMBR.',
        400,
      );
    }
    return {
      provider: 'whatsmiau',
      instanceName: whatsmiau.instance_name,
      apiKey: decryptWhatsmiauApiKey(whatsmiau),
      baseUrl: whatsmiau.base_url,
    };
  }

  const { data: meta, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (error || !meta) {
    throw new ProviderError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
    );
  }

  const accessToken = decrypt(meta.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(meta.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', meta.id)
      .then(({ error: updateError }: { error: { message: string } | null }) => {
        if (updateError) {
          console.warn(
            '[provider-connection] access_token GCM upgrade failed:',
            updateError.message,
          );
        }
      });
  }

  return {
    provider: 'meta',
    phoneNumberId: meta.phone_number_id,
    accessToken,
  };
}
