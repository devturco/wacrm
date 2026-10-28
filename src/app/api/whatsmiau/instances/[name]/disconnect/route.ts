// ============================================================
// Disconnect the number without deleting the connection.
//
// `logout` unlinks the WhatsApp number but keeps the connection and
// its settings — the user re-scans a QR code and is back. Deleting
// the connection is a different, irreversible operation.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { ProviderError } from '@/lib/whatsapp/providers/errors';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import { logoutInstance } from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  crmbrErrorResponse,
  providerErrorResponse,
  resolveOwnedInstance,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import { updateWhatsmiauConfigById } from '@/lib/whatsapp/whatsmiau-config';

type RouteContext = { params: Promise<{ name: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Connection not found.' }, { status: 404 });
    }

    await logoutInstance(whatsmiauConnectionFromConfig(row), row.provider_instance_name);

    // The connection stops being the active one: the app must not keep
    // sending through a number that is no longer linked.
    await updateWhatsmiauConfigById(supabase, row.id, {
      status: 'disconnected',
      connected_at: null,
      phone_number: null,
      is_active: false,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    if (error instanceof ProviderError) {
      return crmbrErrorResponse(error);
    }
    console.error('[whatsmiau/instance] could not disconnect the instance:', error);
    return toErrorResponse(error);
  }
}
