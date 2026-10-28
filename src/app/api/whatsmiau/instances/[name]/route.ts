// ============================================================
// One connection: its state, its settings, its life.
//
// The `:name` in the URL is the name THE CUSTOMER gave their
// connection ("Atendimento"). It is resolved against the ACCOUNT's own
// rows: a name that belongs to another company resolves to nothing and
// the route answers 404 — it never reveals that the connection exists.
//
// The provider is addressed by the row's `provider_instance_name` —
// the namespaced one. The two names never cross over on the way to
// the browser.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { ProviderError } from '@/lib/whatsapp/providers/errors';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  deleteInstance,
  getConnectionState,
  setWebhook,
  updateInstance,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  buildWebhookConfig,
  crmbrErrorResponse,
  providerErrorResponse,
  resolveOwnedInstance,
  webhookUrlFor,
  withoutLockedHeaders,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import {
  deleteWhatsmiauConfig,
  mergeInstanceSettings,
  updateWhatsmiauConfigById,
  type WhatsmiauInstanceSettings,
} from '@/lib/whatsapp/whatsmiau-config';

type RouteContext = { params: Promise<{ name: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Connection not found.' }, { status: 404 });
    }

    const state = await getConnectionState(
      whatsmiauConnectionFromConfig(row),
      row.provider_instance_name,
    );
    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    if (error instanceof ProviderError) {
      return crmbrErrorResponse(error);
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
      return NextResponse.json({ error: 'Connection not found.' }, { status: 404 });
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
    const webhook = buildWebhookConfig(storedSettings, row.webhook_secret, webhookUrl);

    const conn = whatsmiauConnectionFromConfig(row);
    await updateInstance(conn, row.provider_instance_name, { ...storedSettings, webhook });
    await setWebhook(conn, row.provider_instance_name, webhook);

    await updateWhatsmiauConfigById(supabase, row.id, {
      instance_settings: storedSettings,
    });

    return NextResponse.json({ success: true, settings: storedSettings }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    if (error instanceof ProviderError) {
      return crmbrErrorResponse(error);
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
      return NextResponse.json({ error: 'Connection not found.' }, { status: 404 });
    }

    await deleteInstance(whatsmiauConnectionFromConfig(row), row.provider_instance_name);

    // The provider-side instance is gone, so ours goes too — keeping
    // the row would leave a connection that can never be reached.
    await deleteWhatsmiauConfig(supabase, accountId, row.instance_name);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    if (error instanceof ProviderError) {
      return crmbrErrorResponse(error);
    }
    console.error('[whatsmiau/instance] could not delete the instance:', error);
    return toErrorResponse(error);
  }
}
