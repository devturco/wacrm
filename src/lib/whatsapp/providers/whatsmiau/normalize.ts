// ============================================================
// WhatsMiau payload -> the app's internal message model.
//
// The provider is Evolution-API-compatible, so the content lives under
// `data.message.<type>Message`. We derive the kind from the shape
// first (which key is present) and fall back to `data.messageType` —
// the shape is the more reliable of the two.
// ============================================================

import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export type InboundMessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'reaction'
  | 'interactive'
  | 'unknown';

export interface NormalizedInboundMessage {
  messageId: string;
  remoteJid: string;
  fromMe: boolean;
  /** Digits-only phone, empty for a group jid. */
  phone: string;
  /** Epoch seconds. */
  timestamp: number;
  kind: InboundMessageKind;
  text?: string;
  caption?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mimeType?: string;
  fileName?: string;
  reactionEmoji?: string;
  reactedToMessageId?: string;
  buttonReplyId?: string;
  buttonReplyTitle?: string;
  listReplyId?: string;
  listReplyTitle?: string;
  quotedMessageId?: string;
  participant?: string;
  pushName?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** The phone behind a jid — `@s.whatsapp.net` for a direct chat. */
function phoneFromJid(jid: string): string {
  if (!jid) return '';
  if (jid.endsWith('@g.us') || jid.endsWith('@lid')) return '';
  return normalizePhone(jid.split('@')[0] ?? '');
}

export function normalizeInboundMessage(
  data: Record<string, unknown>,
): NormalizedInboundMessage | null {
  const key = asRecord(data.key);
  const messageId = asString(key.id);
  if (!messageId) return null;

  const remoteJid = asString(key.remoteJid) ?? '';
  const fromMe = key.fromMe === true;
  const message = asRecord(data.message);
  const messageType = asString(data.messageType) ?? '';

  const contextInfo = asRecord(data.contextInfo);
  const normalized: NormalizedInboundMessage = {
    messageId,
    remoteJid,
    fromMe,
    phone: phoneFromJid(remoteJid),
    timestamp:
      typeof data.messageTimestamp === 'number' ? data.messageTimestamp : Math.floor(Date.now() / 1000),
    kind: 'unknown',
    ...(asString(data.pushName) ? { pushName: asString(data.pushName)! } : {}),
    ...(asString(key.participant) ? { participant: asString(key.participant)! } : {}),
    ...(asString(contextInfo.stanzaId) ? { quotedMessageId: asString(contextInfo.stanzaId)! } : {}),
  };

  const reaction = asRecord(message.reactionMessage);
  if (Object.keys(reaction).length > 0) {
    normalized.kind = 'reaction';
    const reactionKey = asRecord(reaction.key);
    normalized.reactionEmoji = asString(reaction.text) ?? '';
    normalized.reactedToMessageId = asString(reactionKey.id);
    return normalized;
  }

  const listReply = asRecord(message.listResponseMessage);
  if (Object.keys(listReply).length > 0) {
    normalized.kind = 'interactive';
    normalized.listReplyTitle = asString(listReply.title);
    const selected = asRecord(listReply.singleSelectReply);
    normalized.listReplyId = asString(selected.selectedRowId);
    return normalized;
  }

  const buttonReply = asRecord(message.buttonsResponseMessage);
  if (Object.keys(buttonReply).length > 0) {
    normalized.kind = 'interactive';
    normalized.buttonReplyId = asString(buttonReply.selectedButtonId);
    normalized.buttonReplyTitle = asString(buttonReply.selectedDisplayText);
    return normalized;
  }

  const mediaKinds: Array<{ key: string; kind: InboundMessageKind }> = [
    { key: 'imageMessage', kind: 'image' },
    { key: 'videoMessage', kind: 'video' },
    { key: 'audioMessage', kind: 'audio' },
    { key: 'documentMessage', kind: 'document' },
    { key: 'stickerMessage', kind: 'sticker' },
  ];

  for (const entry of mediaKinds) {
    const payload = asRecord(message[entry.key]);
    if (Object.keys(payload).length === 0) continue;
    normalized.kind = entry.kind;
    normalized.mimeType = asString(payload.mimetype);
    normalized.caption = asString(payload.caption);
    if (entry.kind === 'document') {
      normalized.fileName = asString(payload.fileName) ?? asString(payload.title);
    }
    // `mediaUrl` is only present when the instance has saveMedia on.
    normalized.mediaUrl = asString(message.mediaUrl) ?? asString(payload.url);
    const base64 = asString(payload.base64) ?? asString(message.base64);
    if (base64) normalized.mediaBase64 = base64;
    return normalized;
  }

  const conversation = asString(message.conversation);
  if (conversation !== undefined) {
    normalized.kind = 'text';
    normalized.text = conversation;
    return normalized;
  }

  // Fall back to the declared type when the payload shape is one we
  // don't model — the text is still worth keeping.
  if (messageType === 'conversation' || messageType === 'editedMessage') {
    normalized.kind = 'text';
    normalized.text = '';
    return normalized;
  }

  return normalized;
}

/**
 * Map the provider's delivery status onto the app's ladder.
 * `DELIVERY_ACK` = delivered, `READ` = read.
 */
export function normalizeStatusUpdate(
  data: Record<string, unknown>,
): { messageId: string; status: 'delivered' | 'read' } | null {
  const messageId = asString(data.messageId) ?? asString(data.keyId);
  if (!messageId) return null;
  const status = asString(data.status);
  if (status === 'DELIVERY_ACK') return { messageId, status: 'delivered' };
  if (status === 'READ') return { messageId, status: 'read' };
  return null;
}

export function normalizeConnectionUpdate(
  data: Record<string, unknown>,
): { state: 'open' | 'close'; wuid?: string; profileName?: string; statusReason?: number } | null {
  const state = asString(data.state);
  if (state !== 'open' && state !== 'close') return null;
  return {
    state,
    ...(asString(data.wuid) ? { wuid: asString(data.wuid)! } : {}),
    ...(asString(data.profileName) ? { profileName: asString(data.profileName)! } : {}),
    ...(typeof data.statusReason === 'number' ? { statusReason: data.statusReason } : {}),
  };
}

export function normalizeDeletedMessage(
  data: Record<string, unknown>,
): { messageId: string; remoteJid: string; fromMe: boolean } | null {
  const messageId = asString(data.id);
  if (!messageId) return null;
  return {
    messageId,
    remoteJid: asString(data.remoteJid) ?? '',
    fromMe: data.fromMe === true,
  };
}

export function normalizeEditedMessage(
  data: Record<string, unknown>,
): { messageId: string; text: string } | null {
  const key = asRecord(data.key);
  const messageId = asString(key.id);
  if (!messageId) return null;
  const edited = asRecord(data.editedMessage);
  const text = asString(edited.conversation) ?? '';
  return { messageId, text };
}
