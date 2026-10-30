// ============================================================
// The account's CRMBR (non-official WhatsApp API) state.
//
// GET returns everything the settings screen needs to draw itself:
// whether the platform credential is configured on the server, the
// company's name, and the account's own instances.
//
// There is NO api key and NO base URL in the answer, and there never
// will be: the credential belongs to the platform and lives in the
// server's environment. The customer never holds a key — they pick a
// name for their connection and we provision the instance for them.
//
// The instance list comes from OUR table, never from the provider:
// the provider's account is shared by every subscriber, so asking it
// for "the instances" would show one company's instances to another.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  webhookUrlFor,
  withoutLockedHeaders,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import { isPlatformConfigured } from '@/lib/whatsapp/providers/whatsmiau/platform-credential';
import { syncWhatsmiauStatuses } from '@/lib/whatsapp/providers/whatsmiau/status-sync';
import {
  loadWhatsmiauConfigs,
  type WhatsmiauConfigRow,
} from '@/lib/whatsapp/whatsmiau-config';

/** The shape the browser is allowed to see. */
function publicInstance(row: WhatsmiauConfigRow) {
  return {
    instance_name: row.instance_name,
    status: row.status,
    phone_number: row.phone_number,
    is_active: row.is_active,
    connected_at: row.connected_at,
    // The locked header carries the webhook secret. It is never stored
    // (the instance routes keep it out of `instance_settings`), but the
    // strip below is the belt to that braces: even a hand-edited row
    // cannot push the secret into the browser.
    instance_settings: {
      ...row.instance_settings,
      webhook: {
        ...row.instance_settings.webhook,
        headers: withoutLockedHeaders(row.instance_settings.webhook.headers),
        // The offered list is OURS: the browser must not decide which
        // events it is shown, or which of them it may keep.
        offeredEvents: undefined,
      },
    },
    updated_at: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');

    const { data: account } = await supabase
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .maybeSingle();

    const rows = await loadWhatsmiauConfigs(supabase, accountId);

    // The provider is the truth about a connection, and our row is
    // only a mirror of it. A `connection.update` event that never
    // reached us would leave the row stuck on "connecting" for ever —
    // so the screen asks the provider before it draws the status.
    const synced = await syncWhatsmiauStatuses(supabase, rows);

    return NextResponse.json(
      {
        // The platform credential lives in the environment. When it is
        // missing the screen says the feature is unavailable on this
        // server instead of showing a request that cannot succeed.
        configured: isPlatformConfigured(),
        company_name: account?.name ?? '',
        // The address the server pushes to the provider. It comes from
        // the SERVER, not from the browser: the provider has to be
        // able to reach it, and the browser's own origin is a
        // development address in local testing. Showing the very same
        // string the server uses keeps the screen honest.
        webhook_url: webhookUrlFor(request),
        instances: synced.map(publicInstance),
      },
      { status: 200 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
