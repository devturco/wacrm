// ============================================================
// Disconnect the number without deleting the instance.
//
// `logout` unlinks the WhatsApp number but keeps the instance and
// its settings — the user re-scans a QR code and is back. Deleting
// the instance is a different, irreversible operation.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import { logoutInstance } from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  providerErrorResponse,
  resolveOwnedInstance,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import { upsertWhatsmiauConfig } from '@/lib/whatsapp/whatsmiau-config';

type RouteContext = { params: Promise<{ name: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    await logoutInstance(whatsmiauConnectionFromConfig(row), name);

    await upsertWhatsmiauConfig(supabase, accountId, {
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
    console.error('[whatsmiau/instance] could not disconnect the instance:', error);
    return toErrorResponse(error);
  }
}
