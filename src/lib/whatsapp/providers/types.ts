// ============================================================
// The provider contract.
//
// One active provider per account. The core resolves a
// `ProviderConnection` and hands it to the dispatcher; the dispatcher
// routes to the adapter that knows how to speak that provider's API.
//
// The Meta adapter delegates to the untouched `meta-api.ts` — the
// Meta path's behaviour is byte-for-byte what it was before this
// layer existed.
// ============================================================

import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/lib/whatsapp/meta-api';
import type { MessageTemplate } from '@/types';

export type ProviderId = 'meta' | 'whatsmiau';

export interface MetaConnection {
  provider: 'meta';
  /** Meta's phone_number_id. */
  phoneNumberId: string;
  /** Decrypted Meta access token. */
  accessToken: string;
}

export interface WhatsmiauConnection {
  provider: 'whatsmiau';
  /** The public instance name, used as `:instance` in the URL. */
  instanceName: string;
  /** Decrypted WhatsMiau api key. */
  apiKey: string;
  /** API root, e.g. https://api.whatsmiau.dev/v2 */
  baseUrl: string;
}

export type ProviderConnection = MetaConnection | WhatsmiauConnection;

export interface ProviderSendResult {
  /** The provider's message id (Meta's wamid, WhatsMiau's key.id). */
  messageId: string;
}

export interface SendTextArgs {
  to: string;
  text: string;
  contextMessageId?: string;
}

export interface SendMediaArgs {
  to: string;
  kind: MediaKind;
  /** Public URL the provider fetches at send time. */
  link: string;
  caption?: string;
  filename?: string;
  contextMessageId?: string;
}

export interface SendTemplateArgs {
  to: string;
  templateName: string;
  language?: string;
  template?: MessageTemplate;
  /**
   * Structured per-send values. Typed `unknown` because the callers
   * that hold the raw payload don't know its shape; the Meta adapter
   * narrows it to `SendTimeParams`.
   */
  messageParams?: unknown;
  params?: string[];
  contextMessageId?: string;
}

export interface SendButtonsArgs {
  to: string;
  bodyText: string;
  headerText?: string;
  footerText?: string;
  buttons: InteractiveButton[];
  contextMessageId?: string;
}

export interface SendListArgs {
  to: string;
  bodyText: string;
  buttonLabel: string;
  headerText?: string;
  footerText?: string;
  sections: InteractiveListSection[];
  contextMessageId?: string;
}

export interface SendReactionArgs {
  to: string;
  targetMessageId: string;
  emoji: string;
}

export interface SendTypingArgs {
  to: string;
  /** Inbound message id — Meta needs it to attach the read receipt. */
  messageId?: string;
}
