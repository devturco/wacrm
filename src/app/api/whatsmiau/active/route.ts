// ============================================================
// Which provider is this account sending through?
//
// One active provider per account. Switching is explicit and never
// silent: activating the CRMBR provider requires a PAIRED connection,
// and switching back to Meta requires a connected Meta config. If the
// active provider is broken, sends fail loudly instead of going out
// through the other number.
//
// The account may hold several CRMBR connections; the request names
// the one to activate ("Atendimento"). Only one is ever active.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { syncWhatsmiauStatuses } from '@/lib/whatsapp/providers/whatsmiau/status-sync';
import {
  clearActiveWhatsmiauConfig,
  loadActiveWhatsmiauConfig,
  loadWhatsmiauConfigByInstanceName,
  loadWhatsmiauConfigs,
  setActiveWhatsmiauConfig,
} from '@/lib/whatsapp/whatsmiau-config';

async function metaStatus(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
): Promise<{ status: string; connected: boolean }> {
  const { data } = await supabase
    .from('whatsapp_config')
    .select('status')
    .eq('account_id', accountId)
    .maybeSingle();
  const status = data?.status ?? 'not_configured';
  return { status, connected: status === 'connected' };
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');

    // The provider is the truth about a connection and our row is only
    // a mirror of it. A `connection.update` event that never reached
    // us would leave the account with no active provider — and the
    // inbox would claim the account is not connected while the
    // customer's number is paired and waiting. So the state is checked
    // with the provider before it is answered.
    const rows = await loadWhatsmiauConfigs(supabase, accountId);
    await syncWhatsmiauStatuses(supabase, rows);

    const whatsmiau = await loadActiveWhatsmiauConfig(supabase, accountId);

    if (whatsmiau) {
      return NextResponse.json(
        {
          provider: 'whatsmiau',
          status: whatsmiau.status,
          connected: whatsmiau.status === 'connected',
          instance_name: whatsmiau.instance_name,
          phone_number: whatsmiau.phone_number,
        },
        { status: 200 },
      );
    }

    const meta = await metaStatus(supabase, accountId);
    return NextResponse.json(
      { provider: 'meta', status: meta.status, connected: meta.connected },
      { status: 200 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await request.json();
    const provider = body?.provider;

    if (provider !== 'meta' && provider !== 'whatsmiau') {
      return NextResponse.json(
        { error: 'Unknown provider.', code: 'invalid_provider' },
        { status: 400 },
      );
    }

    if (provider === 'whatsmiau') {
      // Which connection? The body names it the way the customer named
      // it. Without a name we fall back to the account's active one and,
      // failing that, to the first PAIRED one — so the "activate the
      // CRMBR API" call from the hub works even when the account has
      // several connections and none of them is active yet.
      const instanceName =
        typeof body?.instance_name === 'string' ? body.instance_name.trim() : '';

      const row = instanceName
        ? await loadWhatsmiauConfigByInstanceName(supabase, accountId, instanceName)
        : (await loadActiveWhatsmiauConfig(supabase, accountId)) ??
          ((await loadWhatsmiauConfigs(supabase, accountId)).find(
            (item) => item.status === 'connected',
          ) ?? null);

      if (!row) {
        return NextResponse.json(
          {
            error: 'This WhatsApp connection does not exist.',
            code: 'whatsapp_not_configured',
          },
          { status: 404 },
        );
      }
      if (row.status !== 'connected') {
        return NextResponse.json(
          {
            error: 'Pair the WhatsApp number before activating this connection.',
            code: 'provider_not_connected',
          },
          { status: 400 },
        );
      }

      await setActiveWhatsmiauConfig(supabase, accountId, row.instance_name);
      return NextResponse.json(
        { success: true, provider: 'whatsmiau', instance_name: row.instance_name },
        { status: 200 },
      );
    }

    const meta = await metaStatus(supabase, accountId);
    if (!meta.connected) {
      return NextResponse.json(
        {
          error: 'The official Meta API is not connected. Connect it before switching back.',
          code: 'whatsapp_not_configured',
        },
        { status: 400 },
      );
    }

    // Switching back to Meta clears the active CRMBR connection. The
    // partial unique index keeps at most one active per account, so
    // clearing is what makes the switch possible.
    await clearActiveWhatsmiauConfig(supabase, accountId);

    return NextResponse.json({ success: true, provider: 'meta' }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
