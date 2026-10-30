// ============================================================
// The account's WhatsApp connections (the CRMBR API).
//
// GET lists the account's OWN connections. They come from our table,
// never from the provider: the provider's account is shared by every
// subscriber, so asking it for "the instances" would show one
// company's instances to another.
//
// POST creates one. The customer types a name for their connection
// ("Atendimento") and we provision the instance on the PLATFORM's
// provider account, under a namespaced name (`<empresa>_<instancia>`)
// — the customer never holds a key and never learns that the provider
// exists.
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { ProviderError } from '@/lib/whatsapp/providers/errors';
import {
  buildProviderInstanceName,
  validateCustomerInstanceName,
  withCollisionSuffix,
} from '@/lib/whatsapp/providers/whatsmiau/naming';
import { platformCredential } from '@/lib/whatsapp/providers/whatsmiau/platform-credential';
import {
  createInstance,
  deleteInstance,
  setWebhook,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  buildWebhookConfig,
  crmbrErrorResponse,
  isReachableWebhookUrl,
  providerErrorResponse,
  webhookUrlFor,
  WEBHOOK_URL_UNREACHABLE_HINT,
  WEBHOOK_URL_UNREACHABLE_MESSAGE,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import { resolveEvents } from '@/lib/whatsapp/providers/whatsmiau/events';
import {
  generateWebhookSecret,
  isProviderInstanceNameTaken,
  loadWhatsmiauConfigByInstanceName,
  loadWhatsmiauConfigs,
  mergeInstanceSettings,
  upsertWhatsmiauConfig,
  type WhatsmiauConfigRow,
} from '@/lib/whatsapp/whatsmiau-config';

/** How many times we try a suffixed name before giving up. */
const MAX_NAME_ATTEMPTS = 50;

function publicInstance(row: WhatsmiauConfigRow) {
  return {
    instance_name: row.instance_name,
    status: row.status,
    phone_number: row.phone_number,
    is_active: row.is_active,
    connected_at: row.connected_at,
    instance_settings: row.instance_settings,
    updated_at: row.updated_at,
  };
}

/**
 * The name the instance will carry on the provider.
 *
 * `<company>_<instance>`, and a numeric suffix when that name is
 * already taken — two companies with the same name would otherwise
 * collide, and a collision means one of them taking over the other's
 * WhatsApp number.
 */
async function resolveProviderName(
  db: SupabaseClient,
  companyName: string,
  instanceName: string,
): Promise<string | null> {
  const base = buildProviderInstanceName(companyName, instanceName);
  if (!base) return null;
  if (!(await isProviderInstanceNameTaken(db, base))) return base;

  for (let attempt = 2; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = withCollisionSuffix(base, attempt);
    if (!(await isProviderInstanceNameTaken(db, candidate))) return candidate;
  }
  return null;
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const rows = await loadWhatsmiauConfigs(supabase, accountId);
    return NextResponse.json({ instances: rows.map(publicInstance) }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, account } = await requireRole('admin');
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const instanceName =
      typeof body?.instance_name === 'string' ? body.instance_name.trim() : '';

    const nameCheck = validateCustomerInstanceName(instanceName);
    if (!nameCheck.ok) {
      return NextResponse.json(
        { error: nameCheck.error, field: 'instance_name' },
        { status: 400 },
      );
    }

    // The name is the customer's own — it has to be unique inside the
    // account, so they can tell their connections apart.
    const existing = await loadWhatsmiauConfigByInstanceName(supabase, accountId, instanceName);
    if (existing) {
      return NextResponse.json(
        {
          error: 'You already have a WhatsApp connection with this name. Pick another one.',
          field: 'instance_name',
          code: 'instance_name_taken',
        },
        { status: 409 },
      );
    }

    // The company name is what namespaces the instance on the
    // provider. Without it there is nothing to tell one company's
    // instance from another's.
    const companyName = account?.name?.trim() ?? '';
    if (!companyName) {
      return NextResponse.json(
        {
          error:
            'Set your company name in Settings → Profile before creating a WhatsApp connection.',
          field: 'company_name',
          code: 'company_name_missing',
        },
        { status: 400 },
      );
    }

    const providerInstanceName = await resolveProviderName(
      supabase,
      companyName,
      instanceName,
    );
    if (!providerInstanceName) {
      return NextResponse.json(
        { error: 'Could not reserve a name for this connection. Try another name.' },
        { status: 409 },
      );
    }

    // The credential is the platform's, and it is only ever read on
    // the server.
    const { apiKey, baseUrl } = platformCredential();
    const conn = {
      provider: 'whatsmiau' as const,
      instanceName: providerInstanceName,
      apiKey,
      baseUrl,
    };

    const webhookUrl = webhookUrlFor(request);

    // The provider has to be able to REACH the webhook. It refuses a
    // development address (localhost) with its own anti-SSRF guard —
    // so we refuse it FIRST, with a message that says what to do,
    // instead of spending a round trip to be told "invalid webhook
    // URL" in a 400 nobody can act on.
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

    const webhookSecret = generateWebhookSecret();
    const settings = mergeInstanceSettings(null, {});
    // A brand-new connection is offered every event there is — it has
    // no history to respect.
    const resolved = resolveEvents(settings.webhook.events, undefined);
    settings.webhook.events = resolved.events;
    settings.webhook.offeredEvents = resolved.offeredEvents;

    // TWO webhook configs on purpose:
    //   - `storedSettings` is what we keep in the database. It holds the
    //     url and the user's own headers, NEVER the locked
    //     `Authorization` header — the browser reads this row back, and
    //     the webhook secret must not travel there.
    //   - `webhook` is what we push to the provider, with the secret in
    //     the locked header.
    const storedSettings = {
      ...settings,
      webhook: { ...settings.webhook, url: webhookUrl },
    };
    const webhook = buildWebhookConfig(storedSettings, webhookSecret, webhookUrl);

    // `syncFullHistory` is a creation-only flag — the provider refuses
    // to change it later, so it only rides along with the create call.
    //
    // Everything from here on is a chain: create → register the
    // webhook → write our row. If ANY link breaks, the instance would
    // exist at the provider with nothing of ours pointing at it — an
    // orphan the customer can neither see nor delete, and that makes
    // the next attempt collide with a name they never chose. So the
    // chain is unwound on failure.
    let providerInstanceCreated = false;
    try {
      await createInstance(conn, {
        instanceName: providerInstanceName,
        settings: { ...storedSettings, webhook },
        ...(body?.sync_full_history ? { syncFullHistory: true } : {}),
      });
      providerInstanceCreated = true;

      await setWebhook(conn, providerInstanceName, webhook);

      const row = await upsertWhatsmiauConfig(supabase, accountId, {
        instance_name: instanceName,
        provider_instance_name: providerInstanceName,
        webhook_secret: webhookSecret,
        instance_settings: storedSettings,
        status: 'connecting',
        connected_at: null,
      });

      return NextResponse.json(
        { success: true, instance_name: row.instance_name },
        { status: 200 },
      );
    } catch (error) {
      if (providerInstanceCreated) {
        console.error(
          '[crmbr] the connection was not created; removing the instance at the provider:',
          error,
        );
        try {
          await deleteInstance(conn, providerInstanceName);
        } catch (cleanupError) {
          console.error(
            '[crmbr] could not remove the instance at the provider:',
            cleanupError,
          );
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    if (error instanceof ProviderError) {
      return crmbrErrorResponse(error);
    }
    console.error('[whatsmiau/instances] could not create the instance:', error);
    return toErrorResponse(error);
  }
}
