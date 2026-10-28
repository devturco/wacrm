// ============================================================
// WhatsMiau webhook envelope.
//
// Every event arrives in the same envelope:
//   { event, instance, date_time, sender?, server_url?, data }
//
// `instance` is the public instance name. It is NOT the routing key —
// the account is resolved by the webhook secret (see the route);
// the instance name is only a cross-check.
// ============================================================

export interface WhatsmiauWebhookEnvelope {
  event: string;
  instance: string;
  date_time?: string;
  sender?: string;
  server_url?: string;
  data: Record<string, unknown>;
  progress?: number;
  isLatest?: boolean;
}

/** The events this integration acts on. */
export const SUPPORTED_WEBHOOK_EVENTS = [
  'messages.upsert',
  'messages.edited',
  'messages.update',
  'messages.delete',
  'connection.update',
] as const;

export function isSupportedWebhookEvent(event: string): boolean {
  return (SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(event);
}

/**
 * Parse an incoming payload into the envelope. Returns null when the
 * payload isn't a WhatsMiau envelope (missing event, missing instance,
 * or not an object) — the caller answers 400 and logs.
 */
export function parseWhatsmiauWebhook(payload: unknown): WhatsmiauWebhookEnvelope | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  const event = typeof record.event === 'string' ? record.event : '';
  const instance = typeof record.instance === 'string' ? record.instance : '';
  if (!event || !instance) return null;

  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
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
