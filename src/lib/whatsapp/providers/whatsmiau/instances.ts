// ============================================================
// WhatsMiau instance management.
//
// Creating an instance, pairing it with a phone (QR / pairing code),
// reading its connection state, pushing behaviour flags and the
// webhook config, and finally logging out or deleting it.
//
// The instance name is part of every URL, so it is validated locally
// before any request — the provider answers 400 for a bad name, but
// naming the rule locally saves a round trip and gives the UI a
// message it can show next to the field.
// ============================================================

import type {
  WhatsmiauInstanceSettings,
  WhatsmiauWebhookConfig,
} from '@/lib/whatsapp/whatsmiau-config';
import type { WhatsmiauConnection } from '../types';
import { whatsmiauRequest } from './client';

export interface WhatsmiauRemoteInstance {
  name: string;
  id?: string;
  state?: string;
  connected?: boolean;
  suspended?: boolean;
  suspension_reason?: string;
  wuid?: string;
  profileName?: string;
}

export interface WhatsmiauConnectionState {
  state: 'open' | 'closed' | 'connecting' | 'qr-code' | 'unknown';
  connected: boolean;
  suspended: boolean;
  suspension_reason?: string;
  wuid?: string;
  profileName?: string;
}

export interface WhatsmiauQrPayload {
  /** PNG QR code, base64-encoded (no data: prefix). */
  base64: string;
  pairingCode?: string;
  connected: boolean;
}

/** Up to 40 characters, unaccented letters, digits, dot, hyphen, underscore. */
const INSTANCE_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validate an instance name against WhatsMiau's rule: ≤ 40
 * characters, only unaccented letters / digits / dot / hyphen /
 * underscore, and at least one letter or digit.
 */
export function validateInstanceName(
  name: string,
): { ok: true } | { ok: false; error: string } {
  const value = (name ?? '').trim();
  if (!value) {
    return { ok: false, error: 'The instance name is required.' };
  }
  if (value.length > 40) {
    return { ok: false, error: 'The instance name can be at most 40 characters long.' };
  }
  if (!INSTANCE_NAME_RE.test(value)) {
    return {
      ok: false,
      error:
        'The instance name can only contain unaccented letters, numbers, dot, hyphen and underscore.',
    };
  }
  if (!/[A-Za-z0-9]/.test(value)) {
    return { ok: false, error: 'The instance name must contain at least one letter or digit.' };
  }
  return { ok: true };
}

export async function createInstance(
  conn: WhatsmiauConnection,
  args: {
    instanceName: string;
    settings: WhatsmiauInstanceSettings;
    /**
     * Creation-only flag: the provider refuses to change it on
     * `PUT /instance/update`, so it never travels with the settings.
     */
    syncFullHistory?: boolean;
  },
): Promise<void> {
  const { instanceName, settings, syncFullHistory } = args;
  await whatsmiauRequest(conn, {
    method: 'POST',
    path: '/instance/create',
    body: {
      instanceName,
      alwaysOnline: settings.alwaysOnline,
      readMessages: settings.readMessages,
      rejectCall: settings.rejectCall,
      msgCall: settings.msgCall,
      groupsIgnore: settings.groupsIgnore,
      saveMedia: settings.saveMedia,
      ...(syncFullHistory ? { syncFullHistory: true } : {}),
      webhook: settings.webhook,
    },
  });
}

export async function listInstances(
  conn: WhatsmiauConnection,
): Promise<WhatsmiauRemoteInstance[]> {
  const payload = await whatsmiauRequest<unknown>(conn, {
    path: '/instance/fetchInstances',
  });
  if (Array.isArray(payload)) return payload as WhatsmiauRemoteInstance[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.instances)) return record.instances as WhatsmiauRemoteInstance[];
  }
  return [];
}

export async function getConnectionState(
  conn: WhatsmiauConnection,
  name: string,
): Promise<WhatsmiauConnectionState> {
  const payload = await whatsmiauRequest<Record<string, unknown>>(conn, {
    path: `/instance/connectionState/${name}`,
  });
  const rawState = typeof payload?.state === 'string' ? payload.state : 'unknown';
  const state =
    rawState === 'open' || rawState === 'closed' || rawState === 'connecting' || rawState === 'qr-code'
      ? rawState
      : 'unknown';
  return {
    state,
    connected:
      typeof payload?.connected === 'boolean'
        ? payload.connected
        : state === 'open',
    suspended: payload?.suspended === true,
    ...(typeof payload?.suspension_reason === 'string'
      ? { suspension_reason: payload.suspension_reason }
      : {}),
    ...(typeof payload?.wuid === 'string' ? { wuid: payload.wuid } : {}),
    ...(typeof payload?.profileName === 'string' ? { profileName: payload.profileName } : {}),
  };
}

export async function connectInstance(
  conn: WhatsmiauConnection,
  name: string,
  number?: string,
): Promise<WhatsmiauQrPayload> {
  const query = number ? `?number=${encodeURIComponent(number)}` : '';
  const payload = await whatsmiauRequest<Record<string, unknown>>(conn, {
    path: `/instance/connect/${name}${query}`,
  });
  return {
    base64: typeof payload?.base64 === 'string' ? payload.base64 : '',
    ...(typeof payload?.pairingCode === 'string'
      ? { pairingCode: payload.pairingCode }
      : {}),
    connected: payload?.connected === true,
  };
}

export async function updateInstance(
  conn: WhatsmiauConnection,
  name: string,
  settings: WhatsmiauInstanceSettings,
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'PUT',
    path: `/instance/update/${name}`,
    body: {
      alwaysOnline: settings.alwaysOnline,
      readMessages: settings.readMessages,
      rejectCall: settings.rejectCall,
      msgCall: settings.msgCall,
      groupsIgnore: settings.groupsIgnore,
      saveMedia: settings.saveMedia,
      webhook: settings.webhook,
    },
  });
}

export async function logoutInstance(
  conn: WhatsmiauConnection,
  name: string,
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'DELETE',
    path: `/instance/logout/${name}`,
  });
}

export async function deleteInstance(
  conn: WhatsmiauConnection,
  name: string,
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'DELETE',
    path: `/instance/delete/${name}`,
  });
}

export async function getWebhookConfig(
  conn: WhatsmiauConnection,
  name: string,
): Promise<Record<string, unknown> | null> {
  const payload = await whatsmiauRequest<Record<string, unknown>>(conn, {
    path: `/webhook/find/${name}`,
  });
  if (!payload) return null;
  const webhook = payload.webhook;
  if (webhook && typeof webhook === 'object') {
    return webhook as Record<string, unknown>;
  }
  return payload;
}

export async function setWebhook(
  conn: WhatsmiauConnection,
  name: string,
  webhook: WhatsmiauWebhookConfig,
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/webhook/set/${name}`,
    body: { webhook },
  });
}
