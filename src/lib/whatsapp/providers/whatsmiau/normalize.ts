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

  const conversation =
    asString(message.conversation) ?? asString(message.text) ?? asString(message.body);
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
 * The messages an event carries.
 *
 * The documented shape of `messages.upsert` is a NOTIFY batch: `data`
 * holds a `messages` ARRAY (`data.type` is `"notify"`). The
 * Evolution-compatible delivery puts ONE message straight in `data`.
 * Both are read — refusing the batch would silently drop every
 * message of a notify.
 *
 * Null when the payload is not a message payload at all (no batch and
 * no readable id) — the caller logs the shape so the next delivery
 * says what to support.
 */
export function normalizeInboundMessages(
  data: Record<string, unknown>,
): NormalizedInboundMessage[] | null {
  if (Array.isArray(data.messages)) {
    return data.messages
      .map((item) => normalizeInboundMessage(asRecord(item)))
      .filter((message): message is NormalizedInboundMessage => message !== null);
  }
  const single = normalizeInboundMessage(data);
  if (!single) return null;
  return [single];
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

/**
 * A contact the provider tells us about.
 *
 * `contacts.upsert` (§7.6) delivers an ARRAY of these. The picture
 * url in it is the one thing we cannot get any other way when the
 * on-demand lookup fails — the provider pushes it, unprompted.
 */
export interface NormalizedContactUpsert {
  /** Digits-only phone, empty for a group or a lid-only record. */
  phone: string;
  /** The provider's picture url — empty when the payload carries none. */
  profilePicUrl: string;
  /** The display name the provider knows. */
  pushName?: string;
}

/**
 * The contacts of a `contacts.upsert` delivery.
 *
 * The documented shape is an ARRAY; a single object is accepted too,
 * because the provider is Evolution-compatible and the two spellings
 * have been seen in the wild.
 *
 * Records without a phone are dropped: a group jid and a lid-only
 * record cannot be matched to a contact of ours, and guessing would
 * attach a picture to the wrong person.
 */
export function normalizeContactUpsert(data: unknown): NormalizedContactUpsert[] {
  const items = Array.isArray(data) ? data : [data];
  const contacts: NormalizedContactUpsert[] = [];

  for (const item of items) {
    const record = asRecord(item);
    const remoteJid = asString(record.remoteJid) ?? '';
    const remoteLid = asString(record.remoteLid) ?? '';
    const phone = phoneFromJid(remoteJid) || phoneFromJid(remoteLid);
    if (!phone) continue;

    contacts.push({
      phone,
      profilePicUrl: asString(record.profilePicUrl) ?? '',
      ...(asString(record.pushName) ? { pushName: asString(record.pushName)! } : {}),
    });
  }

  return contacts;
}

/**
 * The text of an edited message.
 *
 * The dedicated `messages.edited` event carries the new content under
 * `editedMessage`; until the provider finishes its migration the same
 * edit arrives as an upsert and carries it under `message`. Either way
 * the content is a `Message`, so the text may be the conversation
 * itself or the caption of a media message.
 */
function editedText(source: Record<string, unknown>): string | undefined {
  return (
    asString(source.conversation) ??
    asString(asRecord(source.imageMessage).caption) ??
    asString(asRecord(source.videoMessage).caption) ??
    asString(asRecord(source.documentMessage).caption)
  );
}

/**
 * An edited message: the id of the message that changed and its new
 * text.
 *
 * Null when the payload carries no text — an edit we cannot read is
 * NOT an edit that erases the text we already have.
 */
export function normalizeEditedMessage(
  data: Record<string, unknown>,
): { messageId: string; text: string } | null {
  const key = asRecord(data.key);
  const messageId = asString(key.id);
  if (!messageId) return null;

  const dedicated = asRecord(data.editedMessage);
  const source = Object.keys(dedicated).length > 0 ? dedicated : asRecord(data.message);
  const text = editedText(source);
  if (text === undefined) return null;
  return { messageId, text };
}
