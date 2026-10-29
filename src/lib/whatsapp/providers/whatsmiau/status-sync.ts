// ============================================================
// Keeping our row in step with the provider.
//
// The provider is the truth about a connection: it flips the instance
// to "open" the moment the phone confirms the pairing, and it is the
// only one that knows when the phone goes offline. Our row MIRRORS
// that state — and a mirror is only as good as the last time it was
// checked. A `connection.update` event that arrives while our webhook
// is broken is LOST, and the provider never sends it again: the row
// stays "connecting" for ever, the customer can never activate the
// connection, and the inbox keeps saying the account is not
// connected.
//
// So the routes ask the provider directly and write the answer back.
// The row is a cache of the provider's state — this is what keeps the
// cache honest.
//
// SERVER-ONLY: it reads the platform credential from the environment.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  loadActiveWhatsmiauConfig,
  setActiveWhatsmiauConfig,
  updateWhatsmiauConfigById,
  type WhatsmiauConfigRow,
  type WhatsmiauStatus,
} from '@/lib/whatsapp/whatsmiau-config';

import { whatsmiauConnectionFromConfig } from '../connection';
import { WhatsmiauApiError } from './client';
import { getConnectionState, type WhatsmiauConnectionState } from './instances';

/**
 * How long we wait for the provider's answer about a connection.
 *
 * The reconcile happens while a customer is looking at the screen, so
 * it must be quick: a provider that does not answer must not keep the
 * inbox waiting.
 */
export const CONNECTION_STATE_TIMEOUT_MS = 8_000;

/**
 * What the provider's state means for our row.
 *
 * `unknown` maps to null: the provider did not say anything useful,
 * and the last thing we knew stays true.
 */
function statusFor(state: WhatsmiauConnectionState['state']): WhatsmiauStatus | null {
  switch (state) {
    case 'open':
      return 'connected';
    case 'closed':
    case 'qr-code':
      return 'disconnected';
    case 'connecting':
      return 'connecting';
    default:
      return null;
  }
}

/**
 * Write the provider's state onto our row.
 *
 * Only what the provider actually said is written: a phone number we
 * already know is never erased because the provider did not repeat it.
 */
export async function applyWhatsmiauConnectionState(
  db: SupabaseClient,
  row: WhatsmiauConfigRow,
  state: WhatsmiauConnectionState,
): Promise<WhatsmiauConfigRow> {
  const status = statusFor(state.state);
  if (!status) return row;

  const phone = state.wuid ? normalizePhone(state.wuid) || null : null;
  const connectedAt =
    status === 'connected'
      ? row.connected_at ?? new Date().toISOString()
      : null;

  if (
    row.status === status &&
    row.phone_number === (phone ?? row.phone_number) &&
    row.connected_at === connectedAt
  ) {
    return row;
  }

  const updated = await updateWhatsmiauConfigById(db, row.id, {
    status,
    ...(phone ? { phone_number: phone } : {}),
    ...(state.wuid ? { wuid: state.wuid } : {}),
    connected_at: connectedAt,
  });
  return updated ?? row;
}

/**
 * Read the connection state from the provider and write it back.
 *
 * The provider being unreachable is not a reason to change anything:
 * the stored status is the last thing we knew to be true, so it
 * stays.
 */
export async function syncWhatsmiauStatus(
  db: SupabaseClient,
  row: WhatsmiauConfigRow,
): Promise<WhatsmiauConfigRow> {
  let state: WhatsmiauConnectionState;
  try {
    state = await getConnectionState(
      whatsmiauConnectionFromConfig(row),
      row.provider_instance_name,
      { timeoutMs: CONNECTION_STATE_TIMEOUT_MS },
    );
  } catch (error) {
    if (error instanceof WhatsmiauApiError && error.code === 'whatsmiau_not_found') {
      // The instance is gone from the provider — the connection is
      // gone, and the row must stop claiming it is connected.
      return (
        (await updateWhatsmiauConfigById(db, row.id, {
          status: 'disconnected',
          connected_at: null,
        })) ?? row
      );
    }
    console.error('[crmbr] could not read the connection state:', error);
    return row;
  }

  const updated = await applyWhatsmiauConnectionState(db, row, state);
  await activateIfOnlyUsableConnection(db, row.account_id, updated);
  return updated;
}

/**
 * Check every connection whose state we are not sure about.
 *
 * A row already marked as connected is left alone: the provider tells
 * us when a phone goes offline through the webhook, and asking again
 * on every page load would put a network round trip in front of every
 * screen for nothing.
 */
export async function syncWhatsmiauStatuses(
  db: SupabaseClient,
  rows: WhatsmiauConfigRow[],
): Promise<WhatsmiauConfigRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (row.status === 'connected') {
        // The state is known — but the connection may still never have
        // been activated (the customer paired it before the webhook
        // worked). Ask for it here too.
        await activateIfOnlyUsableConnection(db, row.account_id, row);
        return row;
      }
      return syncWhatsmiauStatus(db, row);
    }),
  );
}

/**
 * Is the official Meta API usable for this account?
 */
async function metaIsConnected(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data } = await db
    .from('whatsapp_config')
    .select('status')
    .eq('account_id', accountId)
    .maybeSingle();
  return data?.status === 'connected';
}

/**
 * Make a paired connection THE active one — but only when the account
 * has nothing else to send through.
 *
 * An account that pairs its number on the CRMBR API and has no
 * working Meta connection has NO active provider at all: the app falls
 * back to Meta, the send fails, and the inbox claims the account is
 * not connected while the customer's number is right there. The first
 * usable CRMBR connection takes over, so the connection the customer
 * just made is the one the app uses.
 *
 * Switching BETWEEN two working providers stays explicit — the hub
 * owns that — and an account with a connected Meta API is never
 * touched.
 */
export async function activateIfOnlyUsableConnection(
  db: SupabaseClient,
  accountId: string,
  row: WhatsmiauConfigRow,
): Promise<void> {
  if (row.status !== 'connected') return;
  try {
    if (await loadActiveWhatsmiauConfig(db, accountId)) return;
    if (await metaIsConnected(db, accountId)) return;
    await setActiveWhatsmiauConfig(db, accountId, row.instance_name);
  } catch (error) {
    // Activation is a convenience — never let it break the screen that
    // asked for the status.
    console.error('[crmbr] could not activate the connection:', error);
  }
}
