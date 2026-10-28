// ============================================================
// The provider dispatcher.
//
// The core asks "send this text" and gets the right provider's call.
// Nothing above this file knows which provider is active.
//
// Import this module instead of `@/lib/whatsapp/meta-api` when you
// want provider-agnostic behaviour. Import `meta-api` directly only
// for Meta-specific features (templates CRUD, media by id, phone
// health, WABA pairing).
// ============================================================

import {
  metaSendButtons,
  metaSendList,
  metaSendMedia,
  metaSendReaction,
  metaSendTemplate,
  metaSendText,
  metaSendTyping,
} from './meta/adapter';
import {
  whatsmiauSendButtons,
  whatsmiauSendList,
  whatsmiauSendMedia,
  whatsmiauSendReaction,
  whatsmiauSendTemplate,
  whatsmiauSendText,
  whatsmiauSendTyping,
} from './whatsmiau/adapter';
import type {
  ProviderConnection,
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTemplateArgs,
  SendTextArgs,
  SendTypingArgs,
} from './types';

export type {
  MetaConnection,
  ProviderConnection,
  ProviderId,
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTemplateArgs,
  SendTextArgs,
  SendTypingArgs,
  WhatsmiauConnection,
} from './types';

export { ProviderError } from './errors';
export {
  assertProviderSupportsMessageType,
  providerSupportsGroups,
  providerSupportsTemplates,
} from './capabilities';
export { resolveProviderConnection } from './connection';

export async function sendTextMessage(
  conn: ProviderConnection,
  args: SendTextArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendText(conn, args)
    : whatsmiauSendText(conn, args);
}

export async function sendMediaMessage(
  conn: ProviderConnection,
  args: SendMediaArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendMedia(conn, args)
    : whatsmiauSendMedia(conn, args);
}

export async function sendTemplateMessage(
  conn: ProviderConnection,
  args: SendTemplateArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendTemplate(conn, args)
    : whatsmiauSendTemplate(conn, args);
}

export async function sendInteractiveButtons(
  conn: ProviderConnection,
  args: SendButtonsArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendButtons(conn, args)
    : whatsmiauSendButtons(conn, args);
}

export async function sendInteractiveList(
  conn: ProviderConnection,
  args: SendListArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendList(conn, args)
    : whatsmiauSendList(conn, args);
}

export async function sendReactionMessage(
  conn: ProviderConnection,
  args: SendReactionArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendReaction(conn, args)
    : whatsmiauSendReaction(conn, args);
}

export async function sendTypingIndicator(
  conn: ProviderConnection,
  args: SendTypingArgs,
): Promise<void> {
  return conn.provider === 'meta'
    ? metaSendTyping(conn, args)
    : whatsmiauSendTyping(conn, args);
}
