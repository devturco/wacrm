// ============================================================
// What each provider can and cannot do.
//
// The non-official API has no message-template endpoint, and no
// group support in this integration. Rather than degrading a template
// into plain text (a campaign that looks like a template but isn't),
// we refuse it loudly.
// ============================================================

import { ProviderError } from './errors';
import type { ProviderConnection } from './types';

/** True when the provider can send an approved template. */
export function providerSupportsTemplates(conn: ProviderConnection): boolean {
  return conn.provider === 'meta';
}

/** True when the provider can address a group (`@g.us`). */
export function providerSupportsGroups(conn: ProviderConnection): boolean {
  return conn.provider === 'meta';
}

/**
 * Throw when the provider can't carry the requested message type.
 * Called BEFORE any write, so a rejected send leaves no orphan
 * contact or conversation behind.
 */
export function assertProviderSupportsMessageType(
  conn: ProviderConnection,
  messageType: string,
): void {
  if (messageType === 'template' && !providerSupportsTemplates(conn)) {
    throw new ProviderError(
      'template_unsupported',
      'The CRMBR (non-official) API does not support message templates. Switch to the Meta API to send template campaigns.',
      400,
    );
  }
}
