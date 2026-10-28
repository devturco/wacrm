// ============================================================
// Helpers shared by the CRMBR management routes.
//
// Everything here is account-scoped: a route resolves the account from
// the session and then uses THAT account's api key and instance name.
// An instance that belongs to another account resolves to `null`, and
// the route answers 404 — the caller can never tell "not yours" from
// "does not exist".
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadWhatsmiauConfig,
  type WhatsmiauConfigRow,
  type WhatsmiauWebhookConfig,
} from '@/lib/whatsapp/whatsmiau-config';
import { WhatsmiauApiError } from './client';
import { LOCKED_WEBHOOK_HEADER, MASKED_API_KEY } from './settings';

// The mask and the locked header live in the dependency-free settings
// module — the browser has to render both, and it cannot import this
// (server-only) module.
export { LOCKED_WEBHOOK_HEADER, MASKED_API_KEY };

/**
 * Drop the locked header from a user-supplied map. The browser never
 * sees the secret, so a saved `Authorization` header could only come
 * from a crafted request — and storing it would leak the secret back
 * to every reader of the config route.
 */
export function withoutLockedHeaders(
  headers: Record<string, string> | undefined | null,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === LOCKED_WEBHOOK_HEADER.toLowerCase()) continue;
    next[key] = value;
  }
  return next;
}

/** Public URL of our webhook, derived from the incoming request. */
export function webhookUrlFor(request: Request): string {
  return `${new URL(request.url).origin}/api/whatsmiau/webhook`;
}

/**
 * The webhook config we push to the provider.
 *
 * The `Authorization` header is LOCKED: it carries the account's
 * webhook secret, and that secret is what the route compares the
 * incoming header against. A user-supplied header can never replace
 * it — the spread comes first, ours last.
 */
export function buildWebhookConfig(
  row: WhatsmiauConfigRow,
  url: string,
): WhatsmiauWebhookConfig {
  return {
    enabled: row.instance_settings.webhook.enabled,
    url,
    headers: {
      ...withoutLockedHeaders(row.instance_settings.webhook.headers),
      [LOCKED_WEBHOOK_HEADER]: `Bearer ${row.webhook_secret}`,
    },
    events: row.instance_settings.webhook.events,
    base64: row.instance_settings.webhook.base64,
  };
}

/**
 * Resolve the account's OWN instance by name. Returns null when the
 * name is not the one this account owns — the caller answers 404.
 */
export async function resolveOwnedInstance(
  db: SupabaseClient,
  accountId: string,
  name: string,
): Promise<WhatsmiauConfigRow | null> {
  const row = await loadWhatsmiauConfig(db, accountId);
  if (!row) return null;
  if (!row.instance_name || row.instance_name !== name) return null;
  return row;
}

/**
 * Shape a provider failure into an HTTP answer. A 401/403 from the
 * provider becomes 401, a suspended instance becomes 409, everything
 * else becomes 502 — the provider is the one that has to change
 * something.
 */
export function providerErrorResponse(error: unknown): NextResponse {
  if (error instanceof WhatsmiauApiError) {
    // The provider's own status is the truth: 401 (bad key), 404 (no
    // such instance), 409 (delete still running / instance suspended),
    // 400 (invalid request). Anything else is a gateway problem.
    const status =
      error.code === 'whatsmiau_unauthorized'
        ? 401
        : error.code === 'whatsmiau_not_found'
          ? 404
          : error.code === 'whatsmiau_conflict' || error.code === 'whatsmiau_suspended'
            ? 409
            : error.code === 'whatsmiau_invalid_request'
              ? 400
              : 502;
    return NextResponse.json(
      { error: error.message, code: error.code, provider_status: error.upstreamStatus },
      { status },
    );
  }
  return NextResponse.json(
    { error: 'Unexpected error while talking to the CRMBR API.', code: 'internal_error' },
    { status: 500 },
  );
}
