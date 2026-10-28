// ============================================================
// Which provider is this account sending through?
//
// One active provider per account. Switching is explicit and never
// silent: activating the CRMBR provider requires a PAIRED instance,
// and switching back to Meta requires a connected Meta config. If the
// active provider is broken, sends fail loudly instead of going out
// through the other number.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  loadWhatsmiauConfig,
  upsertWhatsmiauConfig,
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
    const whatsmiau = await loadWhatsmiauConfig(supabase, accountId);

    if (whatsmiau?.is_active) {
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
      const row = await loadWhatsmiauConfig(supabase, accountId);
      if (!row) {
        return NextResponse.json(
          {
            error: 'The CRMBR (non-official) API is not configured yet.',
            code: 'whatsapp_not_configured',
          },
          { status: 400 },
        );
      }
      if (row.status !== 'connected') {
        return NextResponse.json(
          {
            error: 'Pair the WhatsApp number before activating the CRMBR API.',
            code: 'provider_not_connected',
          },
          { status: 400 },
        );
      }
      await upsertWhatsmiauConfig(supabase, accountId, { is_active: true });
      return NextResponse.json({ success: true, provider: 'whatsmiau' }, { status: 200 });
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

    await upsertWhatsmiauConfig(supabase, accountId, { is_active: false });
    return NextResponse.json({ success: true, provider: 'meta' }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
