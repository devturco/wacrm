// ============================================================
// WhatsMiau adapter — implements the provider contract.
//
// Templates have no endpoint on this provider: asking for one throws
// `template_unsupported` instead of silently degrading to plain text
// (a campaign that looks like a template but isn't is worse than a
// loud failure).
// ============================================================

import type {
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTemplateArgs,
  SendTextArgs,
  SendTypingArgs,
  WhatsmiauConnection,
} from '../types';
import { ProviderError } from '../errors';
import {
  whatsmiauSendText as sendText,
  whatsmiauSendMedia as sendMedia,
  whatsmiauSendButtons as sendButtons,
  whatsmiauSendList as sendList,
  whatsmiauSendReaction as sendReaction,
  whatsmiauSendPresence as sendPresence,
} from './api';

export async function whatsmiauSendText(
  conn: WhatsmiauConnection,
  args: SendTextArgs,
): Promise<ProviderSendResult> {
  return sendText(conn, args);
}

export async function whatsmiauSendMedia(
  conn: WhatsmiauConnection,
  args: SendMediaArgs,
): Promise<ProviderSendResult> {
  return sendMedia(conn, args);
}

export async function whatsmiauSendTemplate(
  _conn: WhatsmiauConnection,
  _args: SendTemplateArgs,
): Promise<ProviderSendResult> {
  throw new ProviderError(
    'template_unsupported',
    'The CRMBR (non-official) API does not support message templates. Use the Meta API for template campaigns.',
    400,
  );
}

export async function whatsmiauSendButtons(
  conn: WhatsmiauConnection,
  args: SendButtonsArgs,
): Promise<ProviderSendResult> {
  return sendButtons(conn, args);
}

export async function whatsmiauSendList(
  conn: WhatsmiauConnection,
  args: SendListArgs,
): Promise<ProviderSendResult> {
  return sendList(conn, args);
}

export async function whatsmiauSendReaction(
  conn: WhatsmiauConnection,
  args: SendReactionArgs,
): Promise<ProviderSendResult> {
  return sendReaction(conn, args);
}

export async function whatsmiauSendTyping(
  conn: WhatsmiauConnection,
  args: SendTypingArgs,
): Promise<void> {
  await sendPresence(conn, { to: args.to });
}
