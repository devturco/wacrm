// ============================================================
// Meta adapter — a thin pass-through to the untouched
// `@/lib/whatsapp/meta-api`.
//
// Every Meta-specific detail (URL shape, token header, payload) stays
// in meta-api.ts. This file only maps the provider contract onto it.
// Keeping the mapping here means an upstream change to meta-api.ts
// breaks THIS file (a TypeScript error we fix) instead of the shared
// core (a merge conflict).
// ============================================================

import {
  sendTextMessage as metaSendTextMessage,
  sendMediaMessage as metaSendMediaMessage,
  sendTemplateMessage as metaSendTemplateMessage,
  sendInteractiveButtons as metaSendInteractiveButtons,
  sendInteractiveList as metaSendInteractiveList,
  sendReactionMessage as metaSendReactionMessage,
  sendTypingIndicator as metaSendTypingIndicator,
} from '@/lib/whatsapp/meta-api';

import type {
  MetaConnection,
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTemplateArgs,
  SendTextArgs,
  SendTypingArgs,
} from '../types';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';

export async function metaSendText(
  conn: MetaConnection,
  args: SendTextArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendTextMessage({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    text: args.text,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendMedia(
  conn: MetaConnection,
  args: SendMediaArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendMediaMessage({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    kind: args.kind,
    link: args.link,
    caption: args.caption,
    filename: args.filename,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendTemplate(
  conn: MetaConnection,
  args: SendTemplateArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendTemplateMessage({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    templateName: args.templateName,
    language: args.language,
    template: args.template,
    messageParams: args.messageParams as SendTimeParams | undefined,
    params: args.params,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendButtons(
  conn: MetaConnection,
  args: SendButtonsArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendInteractiveButtons({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    bodyText: args.bodyText,
    headerText: args.headerText,
    footerText: args.footerText,
    buttons: args.buttons,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendList(
  conn: MetaConnection,
  args: SendListArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendInteractiveList({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    bodyText: args.bodyText,
    buttonLabel: args.buttonLabel,
    headerText: args.headerText,
    footerText: args.footerText,
    sections: args.sections,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendReaction(
  conn: MetaConnection,
  args: SendReactionArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendReactionMessage({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    targetMessageId: args.targetMessageId,
    emoji: args.emoji,
  });
  return { messageId: result.messageId };
}

/**
 * Meta's typing indicator is a field on the read-receipt update, so it
 * needs the inbound message id. A missing id means we cannot show the
 * indicator — skip it rather than firing a request Meta will reject.
 */
export async function metaSendTyping(
  conn: MetaConnection,
  args: SendTypingArgs,
): Promise<void> {
  if (!args.messageId) return;
  await metaSendTypingIndicator({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    messageId: args.messageId,
  });
}
