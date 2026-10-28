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
  webhook: WhatsmiauWebhookConfig;
}

/**
 * The out-of-the-box behaviour of an instance.
 *
 * `readMessages` is OFF on purpose: marking an inbound message as read
 * is an action the operator has to ask for, never one the app does on
 * its own. Everything else mirrors the provider's own defaults.
 */
export const DEFAULT_INSTANCE_SETTINGS: WhatsmiauInstanceSettings = {
  alwaysOnline: false,
  readMessages: false,
  rejectCall: true,
  msgCall: '',
  groupsIgnore: true,
  saveMedia: true,
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
    ],
    base64: false,
  },
};

/** The api key never leaves the server in cleartext — the browser only ever sees this mask. */
export const MASKED_API_KEY = '••••••••••••••••';

/**
 * The webhook header WE own. The account's `webhook_secret` travels
 * in it, and the webhook route compares the incoming header against
 * that secret — so it can never be a user-defined header.
 */
export const LOCKED_WEBHOOK_HEADER = 'Authorization';
