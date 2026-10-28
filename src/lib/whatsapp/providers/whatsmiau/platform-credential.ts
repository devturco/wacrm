// ============================================================
// The PLATFORM credential.
//
// Every company that subscribes to the CRMBR API gets an instance
// provisioned on OUR provider account: the customer never holds a
// key, never sees the provider, and never types one into the app.
// The customer's only input is a name for their connection.
//
// The key therefore lives in the server's environment — never in the
// database, never in the browser:
//
//   WHATSMIAU_API_KEY   the provider's api key (required)
//   WHATSMIAU_BASE_URL  the API base URL (optional)
//
// SERVER-ONLY. This module reads `process.env`; importing it from a
// client component would drag the credential into the browser bundle.
// Every route that needs it is a route handler — they run on the
// server.
// ============================================================

import { ProviderError } from '../errors';

export const DEFAULT_WHATSMIAU_BASE_URL = 'https://api.whatsmiau.dev/v2';

/**
 * The provider credential, read from the server's environment.
 *
 * Throws when the key is missing: the CRMBR API is simply not
 * available on this deployment, and every caller would fail with a
 * confusing "unauthorized" from the provider.
 *
 * The message the customer sees names NEITHER the provider NOR the
 * env var — from the subscriber's point of view the CRMBR API is
 * just a service of ours, and they must not learn that it is a
 * third-party product running on someone else's account. The env var
 * name goes to the server log, where the operator will see it.
 */
export function platformCredential(): { apiKey: string; baseUrl: string } {
  const apiKey = (process.env.WHATSMIAU_API_KEY ?? '').trim();
  if (!apiKey) {
    console.error(
      '[crmbr] the platform credential is missing on this server — set WHATSMIAU_API_KEY.',
    );
    throw new ProviderError(
      'crmbr_not_configured',
      'The CRMBR API is not available on this server. Contact support.',
      503,
    );
  }
  const baseUrl =
    (process.env.WHATSMIAU_BASE_URL ?? '').trim().replace(/\/+$/, '') ||
    DEFAULT_WHATSMIAU_BASE_URL;
  return { apiKey, baseUrl };
}

/**
 * Whether this deployment can talk to the provider at all.
 *
 * The settings screen uses it to explain the situation instead of
 * showing a failed request.
 */
export function isPlatformConfigured(): boolean {
  return Boolean((process.env.WHATSMIAU_API_KEY ?? '').trim());
}
