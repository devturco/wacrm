// ============================================================
// WhatsMiau outbound calls.
//
// The API is Evolution-API-compatible, so the payload shapes mirror
// that convention: `number` carries the digits-only recipient, `media`
// a public URL, `buttons[].displayText` the visible label.
//
// Audio has its own endpoint (/message/sendWhatsAppAudio) — a voice
// note sent through /message/sendMedia is rejected by the provider.
// ============================================================

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type {
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTextArgs,
  WhatsmiauConnection,
} from '../types';
import { ProviderError } from '../errors';
import { whatsmiauRequest } from './client';

/**
 * Pull the provider's message id out of a response. The Evolution
 * shape nests it under `key.id`; older payloads use `messageId` or a
 * flat `id`.
 */
function extractMessageId(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const key = record.key as Record<string, unknown> | undefined;
    if (key && typeof key.id === 'string' && key.id) return key.id;
    if (typeof record.messageId === 'string' && record.messageId) return record.messageId;
    if (typeof record.id === 'string' && record.id) return record.id;
  }
  return '';
}

function requireMessageId(payload: unknown): ProviderSendResult {
  const messageId = extractMessageId(payload);
  if (!messageId) {
    throw new ProviderError(
      'whatsmiau_error',
      'WhatsMiau accepted the message but returned no message id.',
      502,
      payload,
    );
  }
  return { messageId };
}

export async function whatsmiauSendText(
  conn: WhatsmiauConnection,
  args: SendTextArgs,
): Promise<ProviderSendResult> {
  const body: Record<string, unknown> = {
    number: normalizePhone(args.to),
    text: args.text,
  };
  if (args.contextMessageId) {
    body.quoted = { key: { id: args.contextMessageId } };
  }
  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendText/${conn.instanceName}`,
    body,
  });
  return requireMessageId(payload);
}

export async function whatsmiauSendMedia(
  conn: WhatsmiauConnection,
  args: SendMediaArgs,
): Promise<ProviderSendResult> {
  // Audio is a separate endpoint — the provider rejects it on
  // /message/sendMedia.
  if (args.kind === 'audio') {
    const payload = await whatsmiauRequest(conn, {
      method: 'POST',
      path: `/message/sendWhatsAppAudio/${conn.instanceName}`,
      body: {
        number: normalizePhone(args.to),
        audio: args.link,
      },
    });
    return requireMessageId(payload);
  }

  const body: Record<string, unknown> = {
    number: normalizePhone(args.to),
    mediatype: args.kind,
    media: args.link,
  };
  if (args.caption) body.caption = args.caption;
  if (args.kind === 'document' && args.filename) body.fileName = args.filename;
  if (args.contextMessageId) body.quoted = { key: { id: args.contextMessageId } };

  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendMedia/${conn.instanceName}`,
    body,
  });
  return requireMessageId(payload);
}

export async function whatsmiauSendButtons(
  conn: WhatsmiauConnection,
  args: SendButtonsArgs,
): Promise<ProviderSendResult> {
  const body: Record<string, unknown> = {
    number: normalizePhone(args.to),
    description: args.bodyText,
    buttons: args.buttons.map((button) => ({
      type: 'reply',
      displayText: button.title,
      id: button.id,
    })),
  };
  if (args.headerText) body.title = args.headerText;
  if (args.footerText) body.footer = args.footerText;
  if (args.contextMessageId) body.quoted = { key: { id: args.contextMessageId } };

  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendButtons/${conn.instanceName}`,
    body,
  });
  return requireMessageId(payload);
}

export async function whatsmiauSendList(
  conn: WhatsmiauConnection,
  args: SendListArgs,
): Promise<ProviderSendResult> {
  const body: Record<string, unknown> = {
    number: normalizePhone(args.to),
    description: args.bodyText,
    buttonText: args.buttonLabel,
    sections: args.sections.map((section) => ({
      ...(section.title ? { title: section.title } : {}),
      rows: section.rows.map((row) => ({
        title: row.title,
        ...(row.description ? { description: row.description } : {}),
        rowId: row.id,
      })),
    })),
  };
  if (args.headerText) body.title = args.headerText;
  if (args.footerText) body.footerText = args.footerText;
  if (args.contextMessageId) body.quoted = { key: { id: args.contextMessageId } };

  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendList/${conn.instanceName}`,
    body,
  });
  return requireMessageId(payload);
}

export async function whatsmiauSendReaction(
  conn: WhatsmiauConnection,
  args: SendReactionArgs,
): Promise<ProviderSendResult> {
  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendReaction/${conn.instanceName}`,
    body: {
      reaction: args.emoji,
      key: {
        remoteJid: `${normalizePhone(args.to)}@s.whatsapp.net`,
        id: args.targetMessageId,
        fromMe: false,
      },
    },
  });
  return requireMessageId(payload);
}

/**
 * The typing indicator is a presence update. WhatsMiau auto-confirms
 * read receipts when the instance's `readMessages` flag is on, so we
 * never call /chat/markMessageAsRead ourselves.
 */
export async function whatsmiauSendPresence(
  conn: WhatsmiauConnection,
  args: { to: string },
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/chat/sendPresence/${conn.instanceName}`,
    body: {
      number: normalizePhone(args.to),
      presence: 'composing',
      type: 'text',
    },
  });
}
