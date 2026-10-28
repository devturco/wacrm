// ============================================================
// Pair a phone with the instance: the QR code and the pairing code.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  connectInstance,
  logoutInstance,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  providerErrorResponse,
  resolveOwnedInstance,
} from '@/lib/whatsapp/providers/whatsmiau/management';

type RouteContext = { params: Promise<{ name: string }> };

function qrResponse(qr: { base64: string; pairingCode?: string; connected: boolean }) {
  return NextResponse.json(
    {
      base64: qr.base64,
      ...(qr.pairingCode ? { pairing_code: qr.pairingCode } : {}),
      connected: qr.connected,
    },
    { status: 200 },
  );
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    const qr = await connectInstance(whatsmiauConnectionFromConfig(row), name);
    return qrResponse(qr);
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}

/**
 * POST = reconnect. Log the number out first, then ask for a fresh QR
 * code — the provider only hands out a new one for a session that is
 * not logged in.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    const conn = whatsmiauConnectionFromConfig(row);
    await logoutInstance(conn, name);
    const qr = await connectInstance(conn, name);
    return qrResponse(qr);
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}
