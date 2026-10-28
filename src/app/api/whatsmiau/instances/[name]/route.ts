// ============================================================
// One instance: its state, its settings, its life.
//
// Every route here resolves the instance against the ACCOUNT's own
// row. A name that belongs to another company resolves to nothing and
// the route answers 404 — it never reveals that the instance exists.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  deleteInstance,
  getConnectionState,
  setWebhook,
  updateInstance,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  buildWebhookConfig,
  providerErrorResponse,
  resolveOwnedInstance,
  webhookUrlFor,
  withoutLockedHeaders,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import {
  mergeInstanceSettings,
  upsertWhatsmiauConfig,
  type WhatsmiauInstanceSettings,
} from '@/lib/whatsapp/whatsmiau-config';

type RouteContext = { params: Promise<{ name: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    const state = await getConnectionState(whatsmiauConnectionFromConfig(row), name);
    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    const body = await request.json();
    const incoming = (body?.settings ?? {}) as Partial<WhatsmiauInstanceSettings>;
    const merged = mergeInstanceSettings(row.instance_settings, {
      ...incoming,
      // The Authorization header is ours — see the config route.
      ...(incoming.webhook
        ? {
            webhook: {
              ...incoming.webhook,
              headers: withoutLockedHeaders(incoming.webhook.headers),
            },
          }
        : {}),
    });

    // Same split as the create route: the stored row never carries the
    // locked header, only the copy pushed to the provider does.
    const webhookUrl = webhookUrlFor(request);
    const storedSettings = {
      ...merged,
      webhook: { ...merged.webhook, url: webhookUrl },
    };
    const webhook = buildWebhookConfig(
      { ...row, instance_settings: storedSettings },
      webhookUrl,
    );

    const conn = whatsmiauConnectionFromConfig(row);
    await updateInstance(conn, name, { ...storedSettings, webhook });
    await setWebhook(conn, name, webhook);

    await upsertWhatsmiauConfig(supabase, accountId, {
      instance_settings: storedSettings,
    });

    return NextResponse.json({ success: true, settings: storedSettings }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    console.error('[whatsmiau/instance] could not update the instance:', error);
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    await deleteInstance(whatsmiauConnectionFromConfig(row), name);

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
    console.error('[whatsmiau/instance] could not delete the instance:', error);
    return toErrorResponse(error);
  }
}
