// ============================================================
// The account's CRMBR (non-official WhatsApp API) configuration.
//
// GET returns the stored configuration with the api key MASKED — the
// key never travels back to the browser in cleartext.
//
// POST saves it. The api key is encrypted before it touches the
// database, exactly like the Meta access token.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  listInstances,
  validateInstanceName,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import { MASKED_API_KEY, withoutLockedHeaders } from '@/lib/whatsapp/providers/whatsmiau/management';
import {
  decryptWhatsmiauApiKey,
  encryptWhatsmiauApiKey,
  loadWhatsmiauConfig,
  mergeInstanceSettings,
  upsertWhatsmiauConfig,
  type WhatsmiauConfigRow,
  type WhatsmiauInstanceSettings,
} from '@/lib/whatsapp/whatsmiau-config';

const DEFAULT_BASE_URL = 'https://api.whatsmiau.dev/v2';

/** The shape the browser is allowed to see. */
function publicConfig(row: WhatsmiauConfigRow) {
  return {
    instance_name: row.instance_name,
    base_url: row.base_url,
    api_key_masked: MASKED_API_KEY,
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
      },
    },
    updated_at: row.updated_at,
  };
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const row = await loadWhatsmiauConfig(supabase, accountId);
    if (!row) {
      return NextResponse.json({ configured: false }, { status: 200 });
    }
    return NextResponse.json({ configured: true, ...publicConfig(row) }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await request.json();
    const existing = await loadWhatsmiauConfig(supabase, accountId);

    // An empty api key means "keep the stored one" — the settings form
    // never shows the key, so re-entering it on every save would be a
    // toll nobody should pay.
    let apiKey = '';
    if (typeof body.api_key === 'string' && body.api_key.trim() !== '') {
      apiKey = body.api_key.trim();
    } else if (existing) {
      try {
        apiKey = decryptWhatsmiauApiKey(existing);
      } catch {
        return NextResponse.json(
          { error: 'The stored API key could not be decrypted. Please enter it again.', field: 'api_key' },
          { status: 400 },
        );
      }
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: 'The API key is required.', field: 'api_key' },
        { status: 400 },
      );
    }

    const baseUrl =
      typeof body.base_url === 'string' && body.base_url.trim() !== ''
        ? body.base_url.trim().replace(/\/+$/, '')
        : (existing?.base_url ?? DEFAULT_BASE_URL);

    const instanceName =
      typeof body.instance_name === 'string' && body.instance_name.trim() !== ''
        ? body.instance_name.trim()
        : (existing?.instance_name ?? '');

    if (!instanceName) {
      return NextResponse.json(
        { error: 'The instance name is required.', field: 'instance_name' },
        { status: 400 },
      );
    }
    const nameCheck = validateInstanceName(instanceName);
    if (!nameCheck.ok) {
      return NextResponse.json(
        { error: nameCheck.error, field: 'instance_name' },
        { status: 400 },
      );
    }

    const incoming = (body.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>;
    const settings = mergeInstanceSettings(existing?.instance_settings, {
      ...incoming,
      // The Authorization header is ours — a browser can never set it,
      // and storing one would leak the webhook secret back to every
      // reader of this route.
      ...(incoming.webhook
        ? {
            webhook: {
              ...incoming.webhook,
              headers: withoutLockedHeaders(incoming.webhook.headers),
            },
          }
        : {}),
    });

    const row = await upsertWhatsmiauConfig(supabase, accountId, {
      api_key_encrypted: encryptWhatsmiauApiKey(apiKey),
      base_url: baseUrl,
      instance_name: instanceName,
      instance_settings: settings,
    });

    // Verify the key against the provider — BEST EFFORT. The row is
    // already saved, so a provider outage never blocks the setup; the
    // UI surfaces the warning and the user can retry.
    let verified = true;
    let warning: string | undefined;
    try {
      await listInstances(whatsmiauConnectionFromConfig(row));
    } catch (error) {
      verified = false;
      warning =
        error instanceof Error
          ? error.message
          : 'Could not reach the CRMBR API with this key.';
    }

    return NextResponse.json(
      {
        success: true,
        saved: true,
        verified,
        ...(warning ? { warning } : {}),
        config: publicConfig(row),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[whatsmiau/config] could not save the configuration:', error);
    return toErrorResponse(error);
  }
}
