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
  isReachableWebhookUrl,
  providerErrorResponse,
  resolveOwnedInstance,
  webhookUrlFor,
  withoutLockedHeaders,
  WEBHOOK_URL_UNREACHABLE_HINT,
  WEBHOOK_URL_UNREACHABLE_MESSAGE,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import { resolveEvents } from '@/lib/whatsapp/providers/whatsmiau/events';
import {
  activateIfOnlyUsableConnection,
  applyWhatsmiauConnectionState,
  CONNECTION_STATE_TIMEOUT_MS,
} from '@/lib/whatsapp/providers/whatsmiau/status-sync';
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
      { timeoutMs: CONNECTION_STATE_TIMEOUT_MS },
    );

    // The provider is the truth about the connection and our row is
    // only a mirror of it. The pairing poll is exactly when the mirror
    // has to follow — and it is also when the connection becomes the
    // one the app sends through.
    const updated = await applyWhatsmiauConnectionState(supabase, row, state);
    await activateIfOnlyUsableConnection(supabase, accountId, updated);

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

    // The events this connection receives. The list the customer was
    // LAST OFFERED is the one that counts — not the copy the browser
    // happens to carry — so an event that joined the grid after their
    // last save is added, and an event they said no to is left alone.
    const resolved = resolveEvents(
      merged.webhook.events,
      row.instance_settings.webhook.offeredEvents,
    );
    merged.webhook.events = resolved.events;
    merged.webhook.offeredEvents = resolved.offeredEvents;

    // The address the provider delivers to.
    //
    // It is never pushed when the provider cannot reach it: a wrong
    // address does not fail loudly, it fails SILENTLY — the provider
    // answers "no such host" to every delivery and the inbox simply
    // stays empty, with nothing on our side to explain it. When the
    // computed address is unreachable but the stored one still works,
    // the stored one wins: a reconnect must never degrade a delivery
    // that was fine.
    const computedUrl = webhookUrlFor(request);
    const storedUrl = row.instance_settings.webhook.url;
    const webhookUrl = isReachableWebhookUrl(computedUrl)
      ? computedUrl
      : storedUrl && isReachableWebhookUrl(storedUrl)
        ? storedUrl
        : computedUrl;

    if (!isReachableWebhookUrl(webhookUrl)) {
      // The details go to the log, not to the browser: the customer
      // did not configure the deployment and cannot fix it.
      console.error(
        `[crmbr] the webhook address is not reachable: ${webhookUrl}. ${WEBHOOK_URL_UNREACHABLE_HINT}`,
      );
      return NextResponse.json(
        {
          error: WEBHOOK_URL_UNREACHABLE_MESSAGE,
          code: 'webhook_url_unreachable',
        },
        { status: 400 },
      );
    }

    // Same split as the create route: the stored row never carries the
    // locked header, only the copy pushed to the provider does.
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
