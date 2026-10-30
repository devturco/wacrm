// ============================================================
// WhatsMiau webhook envelope.
//
// Every event arrives in the same envelope:
//   { event, instance, date_time, sender?, server_url?, data }
//
// `instance` is the public instance name. It is NOT the routing key —
// the account is resolved by the webhook secret (see the route);
// the instance name is only a cross-check.
//
// The provider names the instance in MORE THAN ONE place: in the
// envelope AND in `data.instanceId` ("instância de origem" — see
// `docs/whatsmiau.md` §7.1). In the Evolution-compatible format both
// carry the compatibility alias (`<nome>_<id>`) rather than the name
// we gave the provider. So every name the payload carries is
// compared, and one match is enough.
// ============================================================

/**
 * The payload of an event.
 *
 * Most events deliver a plain object; `contacts.upsert` delivers an
 * ARRAY (§7.6). Both have to survive the parse, because the entries
 * of that array are the contact records — folding them into an object
 * would lose them.
 */
export type WhatsmiauWebhookData = Record<string, unknown> | unknown[];

export interface WhatsmiauWebhookEnvelope {
  event: string;
  /** The instance name in the envelope — empty when the payload omits it. */
  instance: string;
  date_time?: string;
  sender?: string;
  server_url?: string;
  data: WhatsmiauWebhookData;
  progress?: number;
  isLatest?: boolean;
}

/** The payload as a plain object — an array-shaped event reads as empty. */
export function envelopeRecord(envelope: WhatsmiauWebhookEnvelope): Record<string, unknown> {
  return Array.isArray(envelope.data) ? {} : envelope.data;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The events this integration acts on.
 *
 * `contacts.upsert` is here because it carries the contact's picture
 * url — the provider hands it over for free, and waiting for a message
 * to ask for it again is what left a brand-new account without
 * avatars.
 */
export const SUPPORTED_WEBHOOK_EVENTS = [
  'messages.upsert',
  'messages.edited',
  'messages.update',
  'messages.delete',
  'connection.update',
  'contacts.upsert',
] as const;

export function isSupportedWebhookEvent(event: string): boolean {
  return (SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(event);
}

/**
 * Every name the payload uses for the instance.
 *
 * The envelope's `instance` and the payload's `data.instanceId` are
 * both provider-chosen spellings of the same session. The secret is
 * the routing key — these names are only a cross-check — so reading
 * both costs nothing and leaves no room for a delivery to be refused
 * over a name the provider spelled its own way.
 */
export function instanceNames(envelope: WhatsmiauWebhookEnvelope): string[] {
  const names = new Set<string>();
  if (envelope.instance) names.add(envelope.instance);

  const records = [
    envelopeRecord(envelope),
    // An array-shaped event names the instance inside every entry.
    ...(Array.isArray(envelope.data) ? envelope.data.map(asRecord) : []),
  ];

  for (const record of records) {
    const fromData = record.instanceId;
    if (typeof fromData === 'string' && fromData) names.add(fromData);
  }
  return [...names];
}

/**
 * Parse an incoming payload into the envelope. Returns null when the
 * payload isn't a WhatsMiau envelope (no event, or not an object) —
 * the caller answers 400 and logs.
 *
 * The instance name is NOT required to parse: it is only a cross-check,
 * and the provider names the instance in `data.instanceId` as well. A
 * payload that names no instance at all is refused later, by the
 * cross-check itself.
 */
export function parseWhatsmiauWebhook(payload: unknown): WhatsmiauWebhookEnvelope | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  const event = typeof record.event === 'string' ? record.event : '';
  if (!event) return null;

  const instance = typeof record.instance === 'string' ? record.instance : '';

  // The payload is kept as it arrived: an object for most events, an
  // ARRAY for `contacts.upsert` — whose entries ARE the contacts.
  const rawData = record.data;
  const data: WhatsmiauWebhookData =
    rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : Array.isArray(rawData)
        ? (rawData as unknown[])
        : {};

  return {
    event,
    instance,
    data,
    ...(typeof record.date_time === 'string' ? { date_time: record.date_time } : {}),
    ...(typeof record.sender === 'string' ? { sender: record.sender } : {}),
    ...(typeof record.server_url === 'string' ? { server_url: record.server_url } : {}),
    ...(typeof record.progress === 'number' ? { progress: record.progress } : {}),
    ...(typeof record.isLatest === 'boolean' ? { isLatest: record.isLatest } : {}),
  };
}
