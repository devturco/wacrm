// ============================================================
// Helpers shared by the CRMBR management routes.
//
// Everything here is account-scoped: a route resolves the account from
// the session and then uses THAT account's instances. An instance
// that belongs to another account resolves to `null`, and the route
// answers 404 — the caller can never tell "not yours" from "does not
// exist".
//
// The routes address the provider by the row's `provider_instance_name`
// (the namespaced one) and the customer by the row's `instance_name`.
// The two never cross over on the way to the browser.
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadWhatsmiauConfigByInstanceName,
  type WhatsmiauConfigRow,
  type WhatsmiauInstanceSettings,
  type WhatsmiauWebhookConfig,
} from '@/lib/whatsapp/whatsmiau-config';
import { WhatsmiauApiError } from './client';
import { ProviderError } from '../errors';
import { LOCKED_WEBHOOK_HEADER } from './settings';

// The locked header lives in the dependency-free settings module — the
// browser has to render it, and it cannot import this (server-only)
// module.
export { LOCKED_WEBHOOK_HEADER };

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

/**
 * The public origin of the app — the address the provider delivers
 * events to.
 *
 * Two candidates, and the order matters:
 *
 *   1. **the origin that served the request**, whenever it is already
 *      publicly reachable. In production that IS the app's domain, and
 *      it is right by construction — a stale `NEXT_PUBLIC_SITE_URL`
 *      left over in the environment can then never silently point the
 *      webhook at the wrong host.
 *   2. **`NEXT_PUBLIC_SITE_URL`**, the fallback for when the request
 *      arrives on an address the provider cannot reach: `localhost`
 *      during local development, or an internal host behind a proxy
 *      that does not forward the public one.
 */
function publicOrigin(request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  if (isReachableWebhookUrl(`${requestOrigin}/api/whatsmiau/webhook`)) {
    return requestOrigin;
  }

  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  return requestOrigin;
}

/** Public URL of our webhook, derived from the incoming request. */
export function webhookUrlFor(request: Request): string {
  return `${publicOrigin(request)}/api/whatsmiau/webhook`;
}

/**
 * Hosts that the provider can never reach.
 *
 * The provider documents the webhook destination as a "public HTTPS
 * target, without localhost and private networks (SSRF)". A request
 * built on one of these addresses is guaranteed to be refused — so we
 * refuse it FIRST, with a message that says what to do, instead of
 * letting the provider answer a bare 400.
 */
const UNREACHABLE_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
];

/**
 * Can the provider reach this webhook address?
 *
 * Two rules, both straight from the provider's documentation:
 *   - the destination is HTTPS;
 *   - the host is not a loopback / development address.
 *
 * Private LAN ranges (10.x, 172.16-31.x, 192.168.x) are NOT rejected
 * here: a self-hosted provider may well live there. The hosted one
 * refuses them with its own message, and that message is forwarded
 * verbatim (it names no provider and no account).
 */
export function isReachableWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (UNREACHABLE_HOSTS.includes(host)) return false;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  return true;
}

/**
 * The message the customer sees when the webhook address is unreachable.
 *
 * It names no provider, no environment variable and no address: the
 * subscriber did not configure the deployment and cannot fix it. The
 * details go to the server log, where the operator finds them.
 */
export const WEBHOOK_URL_UNREACHABLE_MESSAGE =
  'The CRMBR API could not deliver events to this app: its public address is not reachable ' +
  'from the internet. Contact support.';

/**
 * The operator-facing note about the same problem — the server log
 * only, never the browser.
 */
export const WEBHOOK_URL_UNREACHABLE_HINT =
  'The webhook address is not reachable from the internet. Publish the app on a public HTTPS ' +
  'domain (or a tunnel such as ngrok/cloudflared) and point NEXT_PUBLIC_SITE_URL at it.';

/**
 * The webhook config we push to the provider.
 *
 * The `Authorization` header is LOCKED: it carries the instance's
 * webhook secret, and that secret is what the route compares the
 * incoming header against. A user-supplied header can never replace
 * it — the spread comes first, ours last.
 */
export function buildWebhookConfig(
  settings: WhatsmiauInstanceSettings,
  secret: string,
  url: string,
): WhatsmiauWebhookConfig {
  return {
    enabled: settings.webhook.enabled,
    url,
    headers: {
      ...withoutLockedHeaders(settings.webhook.headers),
      [LOCKED_WEBHOOK_HEADER]: `Bearer ${secret}`,
    },
    events: settings.webhook.events,
    base64: settings.webhook.base64,
  };
}

/**
 * Resolve the account's OWN instance by the name the customer gave it.
 *
 * Returns null when the name is not the one this account owns — the
 * caller answers 404. Account-scoped on purpose: an instance of
 * another company resolves to null, so the customer can never tell
 * "not yours" from "does not exist".
 */
export async function resolveOwnedInstance(
  db: SupabaseClient,
  accountId: string,
  name: string,
): Promise<WhatsmiauConfigRow | null> {
  if (!name) return null;
  return loadWhatsmiauConfigByInstanceName(db, accountId, name);
}

/**
 * The customer-facing text for a provider failure.
 *
 * The provider's own message is never forwarded: it names the
 * provider, quotes the instance's internal name and can carry details
 * about the platform's account. The customer must not learn that the
 * CRMBR API is a third-party service on someone else's account — from
 * their point of view it is "the CRMBR API" and nothing more.
 */
const CUSTOMER_MESSAGES: Record<string, string> = {
  whatsmiau_unauthorized:
    'The CRMBR API could not be reached with the credentials configured for this server. Contact support.',
  whatsmiau_not_found: 'This WhatsApp connection no longer exists on the CRMBR API.',
  whatsmiau_conflict:
    'The CRMBR API is still busy with a previous operation on this connection. Try again in a moment.',
  whatsmiau_suspended:
    'This WhatsApp connection is suspended on the CRMBR API. Contact support.',
  whatsmiau_invalid_request: 'The CRMBR API rejected the request.',
  whatsmiau_network: 'Could not reach the CRMBR API. Check your connection and try again.',
  whatsmiau_error: 'The CRMBR API returned an unexpected error.',
};

/**
 * Shape a failure that happened on OUR side of the wire.
 *
 * `ProviderError` carries a status and a message that were written
 * for the customer (the platform credential missing is one of them).
 * Anything else collapses to a generic 500 — the raw message never
 * reaches the browser.
 */
export function crmbrErrorResponse(error: unknown): NextResponse {
  if (error instanceof ProviderError) {
    console.error('[crmbr] provider error:', error.code, error.message);
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error('[crmbr] unexpected error:', error);
  return NextResponse.json(
    { error: 'Unexpected error while talking to the CRMBR API.', code: 'internal_error' },
    { status: 500 },
  );
}

/**
 * Did the provider refuse because of the WEBHOOK ADDRESS?
 *
 * Its own text says "invalid webhook URL: host must not point to
 * internal network". The customer does not need to read that — but
 * they DO need to know the address is the problem, otherwise the
 * message is a dead end and they have nothing to act on.
 */
function isWebhookUrlRejection(error: WhatsmiauApiError): boolean {
  if (error.code !== 'whatsmiau_invalid_request') return false;
  const text = error.message.toLowerCase();
  return text.includes('webhook') || text.includes('internal network');
}

/**
 * Shape a provider failure into an HTTP answer. A 401/403 from the
 * provider becomes 401, a suspended instance becomes 409, everything
 * else becomes 502 — the provider is the one that has to change
 * something.
 *
 * The raw upstream message and payload go to the server log, not to
 * the browser.
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

    console.error('[crmbr] provider error:', error.code, error.upstreamStatus, error.message);

    const message = isWebhookUrlRejection(error)
      ? WEBHOOK_URL_UNREACHABLE_MESSAGE
      : (CUSTOMER_MESSAGES[error.code] ?? CUSTOMER_MESSAGES.whatsmiau_error);

    return NextResponse.json(
      { error: message, code: error.code, provider_status: error.upstreamStatus },
      { status },
    );
  }

  console.error('[crmbr] unexpected error:', error);

  return NextResponse.json(
    { error: 'Unexpected error while talking to the CRMBR API.', code: 'internal_error' },
    { status: 500 },
  );
}
