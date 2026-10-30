// ============================================================
// The instance-settings contract shared by the client and the server.
//
// This module is deliberately free of runtime dependencies: the
// CRMBR settings screen is a CLIENT component, and its sibling
// `whatsmiau-config.ts` imports `node:crypto` (the webhook secret)
// and the encryption helper — neither of which can be bundled for
// the browser. The types and the default values live here so both
// sides read the SAME defaults.
// ============================================================

export type WhatsmiauStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WhatsmiauWebhookConfig {
  enabled: boolean;
  url: string;
  headers: Record<string, string>;
  events: string[];
  base64: boolean;
}

export interface WhatsmiauInstanceSettings {
  alwaysOnline: boolean;
  readMessages: boolean;
  rejectCall: boolean;
  msgCall: string;
  groupsIgnore: boolean;
  saveMedia: boolean;
  /**
   * Whether the messages of the WhatsApp CHANNELS the number follows
   * reach the inbox.
   *
   * This one is OURS, not the provider's: the provider has no flag for
   * channels, so the filter lives in our inbound pipeline. Off by
   * default — a channel has an id, not a phone number, so its messages
   * would create a contact nobody can ever answer.
   */
  channelsEnabled: boolean;
  webhook: WhatsmiauWebhookConfig;
}

/**
 * The out-of-the-box behaviour of an instance.
 *
 * `readMessages` is OFF on purpose: marking an inbound message as read
 * is an action the operator has to ask for, never one the app does on
 * its own. `channelsEnabled` is OFF for the same reason — a broadcast
 * feed is not a customer, and the operator has to ask for it.
 * Everything else mirrors the provider's own defaults.
 */
export const DEFAULT_INSTANCE_SETTINGS: WhatsmiauInstanceSettings = {
  alwaysOnline: false,
  readMessages: false,
  rejectCall: true,
  msgCall: '',
  groupsIgnore: true,
  saveMedia: true,
  channelsEnabled: false,
  webhook: {
    enabled: true,
    url: '',
    headers: {},
    events: [
      'messages.upsert',
      'messages.edited',
      'messages.update',
      'messages.delete',
      'connection.update',
      'contacts.upsert',
    ],
    base64: false,
  },
};

/**
 * The webhook header WE own. The account's `webhook_secret` travels
 * in it, and the webhook route compares the incoming header against
 * that secret — so it can never be a user-defined header.
 */
export const LOCKED_WEBHOOK_HEADER = 'Authorization';

/**
 * Deep-compare two settings objects.
 *
 * A plain `JSON.stringify` comparison is not enough: Postgres `jsonb`
 * does NOT preserve key order, so the row that comes back from the
 * server serialises its keys in a different order than the object the
 * form holds — every page load would look "dirty" forever. The events
 * and the headers are compared as sets for the same reason.
 */
export function isSameSettings(
  a: WhatsmiauInstanceSettings,
  b: WhatsmiauInstanceSettings,
): boolean {
  if (
    a.alwaysOnline !== b.alwaysOnline ||
    a.readMessages !== b.readMessages ||
    a.rejectCall !== b.rejectCall ||
    a.groupsIgnore !== b.groupsIgnore ||
    a.saveMedia !== b.saveMedia ||
    a.channelsEnabled !== b.channelsEnabled ||
    a.msgCall !== b.msgCall
  ) {
    return false;
  }
  if (
    a.webhook.enabled !== b.webhook.enabled ||
    a.webhook.base64 !== b.webhook.base64 ||
    a.webhook.url !== b.webhook.url
  ) {
    return false;
  }
  if (a.webhook.events.length !== b.webhook.events.length) return false;
  const savedEvents = new Set(b.webhook.events);
  if (!a.webhook.events.every((event) => savedEvents.has(event))) return false;

  const headers = (source: WhatsmiauInstanceSettings['webhook']['headers']) =>
    Object.entries(source).sort(([x], [y]) => x.localeCompare(y));
  const aHeaders = headers(a.webhook.headers);
  const bHeaders = headers(b.webhook.headers);
  if (aHeaders.length !== bHeaders.length) return false;
  return aHeaders.every(
    ([key, value], index) =>
      bHeaders[index][0] === key && bHeaders[index][1] === value,
  );
}
