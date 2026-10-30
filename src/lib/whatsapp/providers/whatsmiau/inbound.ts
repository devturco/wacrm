// ============================================================
// WhatsMiau inbound pipeline.
//
// The Meta webhook (`src/app/api/whatsapp/webhook/route.ts`) owns a
// 1389-line pipeline: resolve the identity -> find/create the contact ->
// find/create the conversation -> insert the message idempotently ->
// bump the conversation -> reopen it -> flag a broadcast reply -> hand
// the message to the flow runner -> resume a waiting automation -> fire
// the automation triggers -> let the AI reply -> announce
// `message.received`.
//
// We do NOT fork that file. Every provider-agnostic step is delegated to
// the SAME shared helper the Meta path uses, so both providers behave
// identically; only the provider-specific parts — reading the payload
// and fetching the media — live in `normalize.ts` and `mirror-media.ts`.
//
// The order below mirrors the Meta webhook exactly. Order matters here:
// the conversation must exist before `conversation.created`, the reaction
// short-circuit must run before the message insert, and the idempotency
// boundary must sit BEFORE the unread bump and the whole fan-out, so a
// redelivery cannot double-bump, re-advance a flow, re-fire an
// automation or re-invoke the AI.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { resumeAwaitingReply, runAutomationsForTrigger } from '@/lib/automations/engine';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { claimFirstInboundMessage } from '@/lib/conversations/first-inbound';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { flagBroadcastReply } from '@/lib/whatsapp/broadcast-recipient-webhook';
import { applyMessageStatus } from '@/lib/whatsapp/message-status-sync';
import type { MediaStorage } from '@/lib/media/storage';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  updateWhatsmiauConfigById,
  type WhatsmiauInstanceSettings,
} from '@/lib/whatsapp/whatsmiau-config';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { stripLeadCode } from '@/lib/leads/inbound';
import { resolveOrigin } from '@/lib/leads/origin';
import { createLeadOriginStore } from '@/lib/leads/store';

import { refreshContactAvatar } from './avatar';
import { isChannelJid, isGroupJid } from './channels';
import { mirrorWhatsmiauMedia } from './mirror-media';
import type { NormalizedInboundMessage } from './normalize';
import { platformCredential, isPlatformConfigured } from './platform-credential';
import { activateIfOnlyUsableConnection } from './status-sync';
import type { WhatsmiauConnection } from '../types';

export interface WhatsmiauInboundContext {
  db: SupabaseClient;
  accountId: string;
  /** Audit user stamped on the contact / conversation rows we create. */
  ownerUserId: string;
  instanceSettings: WhatsmiauInstanceSettings;
  /**
   * The account's storage — used to mirror inbound media and the
   * contact's picture. It is the account's configured backend (Supabase
   * bucket or R2), not a fixed one.
   */
  storage: MediaStorage;
  /**
   * The row of the connection this event belongs to. The account may
   * hold several CRMBR connections, so a status change has to land on
   * THIS one — not on "the account's connection", which does not exist
   * anymore.
   */
  configId: string;
  /**
   * The instance name ON THE PROVIDER — the namespaced one
   * (`<empresa>_<instancia>`). It goes into the provider's URLs, so
   * the customer's own name never leaves the app.
   */
  providerInstanceName: string;
}

export interface InboundOutcome {
  /** `inserted` — new row written. `replay` — redelivery, ignored. */
  disposition: 'inserted' | 'replay' | 'skipped';
  conversationId?: string;
  contactId?: string;
}

/**
 * Tombstone written into `messages.content_text` when the sender
 * deletes a message. The `messages` table has no `deleted` column and
 * the Global Constraints forbid altering an existing table, so the
 * marker lives in the text column.
 */
export const DELETED_MESSAGE_TEXT = '[deleted]';

/** The `messages.content_type` vocabulary allowed by the CHECK constraint. */
const ALLOWED_CONTENT_TYPES = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);

function contentTypeFor(kind: NormalizedInboundMessage['kind']): string {
  const candidate = ((): string => {
    switch (kind) {
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
        return kind;
      case 'sticker':
        return 'image';
      case 'interactive':
        return 'interactive';
      default:
        return 'text';
    }
  })();

  // The CHECK constraint on `messages.content_type` is the real
  // authority: a value outside the vocabulary aborts the insert, so we
  // degrade to `text` rather than drop the message.
  return ALLOWED_CONTENT_TYPES.has(candidate) ? candidate : 'text';
}

interface ContactOutcome {
  contact: { id: string; phone: string; name?: string | null; avatar_url?: string | null };
  wasCreated: boolean;
}

interface ConversationOutcome {
  conversation: {
    id: string;
    status?: string | null;
    first_inbound_at?: string | null;
    last_message_at?: string | null;
  };
  created: boolean;
}

/**
 * Find the contact for this phone number, or create it.
 *
 * Same shape as the Meta webhook's private helper, minus the BSUID
 * branch (WhatsMiau is phone-only) — and it reuses the same shared
 * `findExistingContact` dedupe, so a contact created by the manual form
 * or by the CSV import is found here too.
 */
async function findOrCreateContact(
  ctx: WhatsmiauInboundContext,
  phone: string,
  name: string | null,
): Promise<ContactOutcome | null> {
  const { db, accountId, ownerUserId } = ctx;

  const existing = await findExistingContact(db, accountId, phone);
  if (existing) return { contact: existing, wasCreated: false };

  const { data, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: name ?? phone,
    })
    .select()
    .single();

  if (error) {
    // Lost a race: a concurrent delivery created the contact between the
    // lookup and the insert. Re-resolve instead of dropping the message.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, phone);
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error('[whatsmiau] could not create the contact:', error.message);
    return null;
  }

  return { contact: data as ContactOutcome['contact'], wasCreated: true };
}

/**
 * Find the account's conversation for this contact, or create it.
 *
 * Deliberately NOT `.single()`: `.single()` errors on 0 rows AND on 2+
 * rows, and treating that error as "none found" is how a race used to
 * snowball into a wall of duplicate chats (issue #363). Oldest-first +
 * limit(1) resolves to the same survivor the dedupe migration keeps.
 */
async function findOrCreateConversation(
  ctx: WhatsmiauInboundContext,
  contactId: string,
): Promise<ConversationOutcome | null> {
  const { db, accountId, ownerUserId } = ctx;

  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findError) {
    console.error('[whatsmiau] could not look up the conversation:', findError.message);
    return null;
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0] as ConversationOutcome['conversation'], created: false };
  }

  const { data, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
    })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return { conversation: raced[0] as ConversationOutcome['conversation'], created: false };
      }
    }
    console.error('[whatsmiau] could not create the conversation:', error.message);
    return null;
  }

  return { conversation: data as ConversationOutcome['conversation'], created: true };
}

/**
 * Persist a reaction. Reactions are per-(target, actor) state, not
 * messages — we upsert / delete on `message_reactions` and never write
 * a row into `messages`.
 */
async function applyReaction(
  ctx: WhatsmiauInboundContext,
  message: NormalizedInboundMessage,
  conversationId: string,
  contactId: string,
): Promise<void> {
  const target = message.reactedToMessageId;
  if (!target) return;

  const { data } = await ctx.db
    .from('messages')
    .select('id')
    .eq('message_id', target)
    .eq('conversation_id', conversationId)
    .maybeSingle();

  const targetInternalId = (data as { id: string } | null)?.id;
  if (!targetInternalId) {
    console.warn('[whatsmiau] reaction target not found; skipping:', target);
    return;
  }

  // An empty emoji means the reaction was removed.
  if (!message.reactionEmoji) {
    const { error } = await ctx.db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (error) console.error('[whatsmiau] reaction delete failed:', error.message);
    return;
  }

  const { error } = await ctx.db
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: message.reactionEmoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' },
    );
  if (error) console.error('[whatsmiau] reaction upsert failed:', error.message);
}

/**
 * The provider connection for the platform credential.
 *
 * The credential lives in the server's environment. A deployment
 * without it simply has no pictures — the rest of the app keeps
 * working, so this returns null instead of throwing.
 */
function providerConnection(instanceName: string): WhatsmiauConnection | null {
  // A deployment without the platform credential simply has no
  // pictures — the rest of the app keeps working.
  if (!isPlatformConfigured()) return null;
  try {
    const { apiKey, baseUrl } = platformCredential();
    return { provider: 'whatsmiau', instanceName, apiKey, baseUrl };
  } catch {
    return null;
  }
}

/**
 * Handle one inbound message from the provider.
 *
 * `disposition` tells the caller what happened: `inserted` (a new row),
 * `replay` (the provider redelivered — already stored, nothing else
 * ran) or `skipped` (nothing to do — a group, our own echo, a
 * reaction).
 */
export async function handleWhatsmiauInboundMessage(
  ctx: WhatsmiauInboundContext,
  message: NormalizedInboundMessage,
): Promise<InboundOutcome> {
  const { db, accountId, ownerUserId } = ctx;

  // Groups are out of scope for v1 — `groupsIgnore` defaults to true on
  // the provider side, but if one still arrives we drop it: our contact
  // model is phone-based, and a group JID would create a contact nobody
  // can ever answer.
  if (isGroupJid(message.remoteJid)) {
    return { disposition: 'skipped' };
  }

  // A channel is a broadcast feed, not a person: its id is not a phone
  // number, so letting one through creates a contact nobody can ever
  // answer. The provider has no flag for it — the account decides, per
  // instance, and it is OFF by default.
  if (!ctx.instanceSettings.channelsEnabled && isChannelJid(message.remoteJid)) {
    return { disposition: 'skipped' };
  }

  const phone = normalizePhone(message.phone);
  if (!phone) return { disposition: 'skipped' };

  // Our own message, echoed back by the provider. Two very different
  // things share this branch:
  //
  //   1. The CRM sent it — the row is already in `messages` and the
  //      echo only tells us the provider accepted it. We reconcile the
  //      status of the row we wrote and stop.
  //   2. It was sent from the PHONE — the agent typed it in WhatsApp,
  //      not in the CRM. Nobody wrote a row, so nobody is going to:
  //      without this, the conversation shows only what the other side
  //      said and the customer looks like they are talking to nobody.
  if (message.fromMe) {
    const stored = await findMessageIdInAccount(ctx, message.messageId);
    if (stored) {
      await applyMessageStatus(db, accountId, {
        wamid: message.messageId,
        status: 'sent',
        failure: null,
        statusAt: new Date(message.timestamp * 1000).toISOString(),
      });
      return { disposition: 'skipped' };
    }
    return storeOwnPhoneMessage(ctx, message);
  }

  const contactOutcome = await findOrCreateContact(ctx, phone, message.pushName ?? null);
  if (!contactOutcome) return { disposition: 'skipped' };

  const conversationOutcome = await findOrCreateConversation(ctx, contactOutcome.contact.id);
  if (!conversationOutcome) return { disposition: 'skipped' };
  const conversation = conversationOutcome.conversation;

  // conversation.created fires as soon as the thread is open — BEFORE
  // the reaction short-circuit, so a thread first opened by a reaction
  // still announces itself.
  if (conversationOutcome.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactOutcome.contact.id,
    });
  }

  // Reactions are not messages: no row, no unread bump, no last-message
  // summary.
  if (message.kind === 'reaction') {
    await applyReaction(ctx, message, conversation.id, contactOutcome.contact.id);
    return {
      disposition: 'skipped',
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
    };
  }

  // Media. The provider's url is public but expiring, so we copy the
  // bytes into our own bucket. A mirror failure is not fatal: the row
  // keeps the provider's url.
  let mediaUrl: string | null = message.mediaUrl ?? null;
  const mediaType: string | null = message.mimeType ?? null;
  if (message.kind !== 'text' && message.kind !== 'interactive') {
    const mirrored = await mirrorWhatsmiauMedia({
      storage: ctx.storage,
      mediaId: message.messageId,
      mediaUrl: message.mediaUrl ?? null,
      mediaBase64: message.mediaBase64 ?? null,
      mimeType: message.mimeType ?? null,
      fileName: message.fileName ?? null,
      messageTimestamp: message.timestamp,
    });
    if (mirrored) mediaUrl = mirrored;
  }

  const contentType = contentTypeFor(message.kind);
  const interactiveReplyId = message.buttonReplyId ?? message.listReplyId ?? null;
  const contentText =
    message.kind === 'interactive'
      ? (message.buttonReplyTitle ?? message.listReplyTitle ?? '')
      : (message.text ?? message.caption ?? null);

  // The lead code — the agent reads the clean text. See the Meta
  // webhook for the full story.
  const rawContentText = contentText;
  const stripped = stripLeadCode(rawContentText);
  const agentText = stripped.text;

  // Resolve the swipe-reply context. A missing parent is fine — the row
  // stores NULL and the bubble renders without a quote.
  let replyToInternalId: string | null = null;
  if (message.quotedMessageId) {
    const { data } = await db
      .from('messages')
      .select('id')
      .eq('message_id', message.quotedMessageId)
      .eq('conversation_id', conversation.id)
      .maybeSingle();
    replyToInternalId = (data as { id: string } | null)?.id ?? null;
  }

  const receivedAt = new Date(message.timestamp * 1000).toISOString();

  // Idempotent insert. The provider redelivers on failure, and every
  // retry replays the same `key.id`. The unique index on
  // (conversation_id, message_id) makes the replay conflict;
  // `ignoreDuplicates` turns that into ON CONFLICT DO NOTHING, and the
  // `.select()` then returns a row ONLY on a genuine first insert — an
  // empty result means this delivery is a replay. This boundary MUST
  // sit before the unread bump and the fan-out below.
  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: agentText,
        media_url: mediaUrl,
        media_type: mediaType,
        message_id: message.messageId,
        status: 'delivered',
        created_at: receivedAt,
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id');

  if (msgError) {
    console.error('[whatsmiau] could not store the message:', msgError.message);
    return {
      disposition: 'skipped',
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
    };
  }

  if (!insertedRows || insertedRows.length === 0) {
    console.info('[whatsmiau] duplicate inbound message ignored (replay):', message.messageId);
    return {
      disposition: 'replay',
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
    };
  }

  // Where this lead came from. AFTER the idempotency boundary: a
  // replayed delivery must not write a second origin.
  //
  // whatsmiau does not expose the ad that produced the message, so
  // there is no referral here — the code in the text and the phone
  // number are the two bridges back to the click.
  try {
    await resolveOrigin(createLeadOriginStore(db), {
      accountId,
      contactId: contactOutcome.contact.id,
      provider: 'whatsmiau',
      channel: 'whatsapp',
      phone,
      leadToken: stripped.token,
      rawText: rawContentText,
      referral: null,
      touchedAt: receivedAt,
    });
  } catch (originError) {
    console.error(
      '[whatsmiau] could not record the lead origin:',
      originError,
    );
  }

  const isFirstInboundMessage = await claimFirstInboundMessage(db, conversation, receivedAt);

  // The unread bump is DB-side (migration 037) so two concurrent
  // deliveries cannot lose one increment (issue #369).
  const { error: convError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: agentText || `[${message.kind}]`,
  });
  if (convError) {
    console.error('[whatsmiau] could not bump the conversation:', convError.message);
  }

  // A customer writing again re-opens the thread (issue #409).
  await reopenClosedConversation(db, conversation);

  // Flag the reply so the broadcast's `replied_count` advances.
  await flagBroadcastReply(db, accountId, contactOutcome.contact.id);

  // The contact's picture. The provider knows it and we do not; the
  // bytes are copied into our own bucket so the URL never expires.
  // It runs AFTER the message is stored — a slow provider must not
  // hold the message back.
  const connection = providerConnection(ctx.providerInstanceName);
  if (connection) {
    await refreshContactAvatar({
      db,
      accountId,
      storage: ctx.storage,
      conn: connection,
      contactId: contactOutcome.contact.id,
      phone,
      currentAvatarUrl: contactOutcome.contact.avatar_url ?? null,
    }).catch((error) =>
      console.error('[whatsmiau] could not refresh the contact picture:', error),
    );
  }

  // The flow runner. When it consumes the message we suppress the
  // content-level automation triggers — the customer is navigating a
  // menu, not sending a fresh trigger word.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: ownerUserId,
    contactId: contactOutcome.contact.id,
    conversationId: conversation.id,
    message: interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: interactiveReplyId,
          reply_title: agentText ?? '',
          meta_message_id: message.messageId,
        }
      : {
          kind: 'text',
          text: agentText ?? '',
          meta_message_id: message.messageId,
        },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  const inboundText = agentText ?? '';

  // An automation parked at a "wait for reply" step takes this message
  // as its reply and continues from the next step.
  const automationConsumed = flowConsumed
    ? false
    : await resumeAwaitingReply({
        accountId,
        contactId: contactOutcome.contact.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
          interactive_reply_id: interactiveReplyId ?? undefined,
        },
      });
  const contentConsumed = flowConsumed || automationConsumed;

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = [];
  if (!contentConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    if (interactiveReplyId) automationTriggers.push('interactive_reply');
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message');

  // Awaited, never fire-and-forget: we run inside the route's `after()`
  // block, which only keeps the function alive for the promises it can
  // see — a detached dispatch can be frozen half-done (issue #301).
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactOutcome.contact.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[whatsmiau] automation dispatch failed:', err));
  }

  // AI auto-reply. Only for plain text the flow runner did not consume.
  if (!contentConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
      configOwnerUserId: ownerUserId,
      inboundMessageId: message.messageId,
    });
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactOutcome.contact.id,
    whatsapp_message_id: message.messageId,
    content_type: contentType,
    text: agentText,
  });

  return {
    disposition: 'inserted',
    conversationId: conversation.id,
    contactId: contactOutcome.contact.id,
  };
}

/**
 * Store a message the agent sent from the PHONE (not from the CRM).
 *
 * The provider echoes our own messages back through the webhook, and
 * this is where the echo of a phone-typed message is written down. It
 * is NOT a customer message: it does not bump the unread counter, does
 * not re-open a closed conversation, and does not fire an automation,
 * a flow or the AI reply. It is a line in the conversation — the same
 * one the person on the other side sees in their WhatsApp.
 *
 * The contact has to exist already. A message we sent to a number
 * nobody wrote to us from does not make a customer; that one stays on
 * the phone.
 */
async function storeOwnPhoneMessage(
  ctx: WhatsmiauInboundContext,
  message: NormalizedInboundMessage,
): Promise<InboundOutcome> {
  const { db, accountId } = ctx;

  const phone = normalizePhone(message.phone);
  if (!phone) return { disposition: 'skipped' };

  const contact = await findExistingContact(db, accountId, phone);
  if (!contact) return { disposition: 'skipped' };

  const conversationOutcome = await findOrCreateConversation(ctx, contact.id);
  if (!conversationOutcome) return { disposition: 'skipped' };
  const conversation = conversationOutcome.conversation;

  // A thread opened by our own message still announces itself — the
  // same rule the inbound path follows.
  if (conversationOutcome.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contact.id,
    });
  }

  // The provider's copy of the media is temporary — the same mirror
  // the inbound path does, so the attachment is ours too.
  let mediaUrl: string | null = message.mediaUrl ?? null;
  const mediaType: string | null = message.mimeType ?? null;
  if (message.kind !== 'text' && message.kind !== 'interactive') {
    const mirrored = await mirrorWhatsmiauMedia({
      storage: ctx.storage,
      mediaId: message.messageId,
      mediaUrl: message.mediaUrl ?? null,
      mediaBase64: message.mediaBase64 ?? null,
      mimeType: message.mimeType ?? null,
      fileName: message.fileName ?? null,
      messageTimestamp: message.timestamp,
    });
    if (mirrored) mediaUrl = mirrored;
  }

  const contentType = contentTypeFor(message.kind);
  const contentText =
    message.kind === 'interactive'
      ? (message.buttonReplyTitle ?? message.listReplyTitle ?? '')
      : (message.text ?? message.caption ?? null);

  const sentAt = new Date(message.timestamp * 1000).toISOString();

  // Idempotent: the provider redelivers, and the CRM's own insert may
  // have landed in the meantime. The unique index on
  // (conversation_id, message_id) turns the replay into a no-op.
  const { data: insertedRows, error } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'agent',
        // The phone has no app user behind it — the agent is whoever
        // holds the device.
        sender_id: null,
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        media_type: mediaType,
        message_id: message.messageId,
        status: 'sent',
        created_at: sentAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    console.error('[whatsmiau] could not store our own message:', error.message);
    return {
      disposition: 'skipped',
      conversationId: conversation.id,
      contactId: contact.id,
    };
  }

  if (!insertedRows || insertedRows.length === 0) {
    console.info('[whatsmiau] duplicate own message ignored (replay):', message.messageId);
    return {
      disposition: 'replay',
      conversationId: conversation.id,
      contactId: contact.id,
    };
  }

  await updateConversationPreview(ctx, conversation, contentText, message.kind, sentAt);

  // A human is handling this conversation from the phone — the app
  // must stop talking over them, exactly as it does when the message
  // is sent from the CRM.
  await pauseActiveFlow(ctx, contact.id);

  return {
    disposition: 'inserted',
    conversationId: conversation.id,
    contactId: contact.id,
  };
}

/**
 * Move the conversation's preview to our own message.
 *
 * Only when it IS the last message: a delivery that arrives late (the
 * phone was offline and the provider caught up) must not overwrite
 * the preview of a newer message.
 */
async function updateConversationPreview(
  ctx: WhatsmiauInboundContext,
  conversation: { id: string; last_message_at?: string | null },
  contentText: string | null,
  kind: NormalizedInboundMessage['kind'],
  sentAt: string,
): Promise<void> {
  const lastAt = conversation.last_message_at;
  if (lastAt && new Date(lastAt).getTime() > new Date(sentAt).getTime()) return;

  const { error } = await ctx.db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${kind}]`,
      last_message_at: sentAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  if (error) {
    console.error('[whatsmiau] could not update the conversation preview:', error.message);
  }
}

/**
 * Pause the flow that is running for this contact.
 *
 * The agent stepping in — from the app or from the phone — is the
 * strongest "yield, a human is here" signal there is. Best-effort:
 * a flow that keeps running is annoying, but it must not cost us the
 * message.
 */
async function pauseActiveFlow(
  ctx: WhatsmiauInboundContext,
  contactId: string,
): Promise<void> {
  try {
    const { error } = await ctx.db
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active');
    if (error) {
      console.error('[whatsmiau] pause-on-agent-send failed:', error.message);
    }
  } catch (err) {
    console.error(
      '[whatsmiau] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * A delivery-status event. The provider's `DELIVERY_ACK` / `READ` were
 * already mapped onto the app's ladder by `normalizeStatusUpdate`, so
 * `applyMessageStatus` accepts them directly.
 */
export async function handleWhatsmiauStatusUpdate(
  ctx: WhatsmiauInboundContext,
  update: { messageId: string; status: 'delivered' | 'read' },
): Promise<void> {
  await applyMessageStatus(ctx.db, ctx.accountId, {
    wamid: update.messageId,
    status: update.status,
    failure: null,
    statusAt: null,
  });
}

/**
 * The instance connected or dropped. We mirror that onto our own row so
 * the settings screen and the hub show the truth without asking the
 * provider on every page load.
 */
export async function handleWhatsmiauConnectionUpdate(
  ctx: WhatsmiauInboundContext,
  update: {
    state: 'open' | 'close';
    wuid?: string;
    profileName?: string;
    statusReason?: number;
  },
): Promise<void> {
  const { db, configId } = ctx;

  // `statusReason` is the provider's own code: 200 means "no problem",
  // anything else means the instance dropped for a reason.
  if (update.statusReason !== undefined && update.statusReason !== 200) {
    await updateWhatsmiauConfigById(db, configId, {
      status: 'error',
      connected_at: null,
    });
    return;
  }

  if (update.state === 'open') {
    const row = await updateWhatsmiauConfigById(db, configId, {
      status: 'connected',
      phone_number: update.wuid ? normalizePhone(update.wuid) || null : null,
      wuid: update.wuid ?? null,
      connected_at: new Date().toISOString(),
    });
    // The number is paired: if this account has nothing else to send
    // through, this connection becomes the one the app uses.
    if (row) {
      await activateIfOnlyUsableConnection(db, ctx.accountId, row);
    }
    return;
  }

  await updateWhatsmiauConfigById(db, configId, {
    status: 'disconnected',
    connected_at: null,
  });
}

/**
 * The sender edited a message. The `messages` table has no `edited`
 * column and the Global Constraints forbid altering it, so the new text
 * overwrites the old one — which is what "edited" means to a reader.
 */
export async function handleWhatsmiauEditedMessage(
  ctx: WhatsmiauInboundContext,
  update: { messageId: string; text: string },
): Promise<void> {
  const internalId = await findMessageIdInAccount(ctx, update.messageId);
  if (!internalId) return;

  const { error } = await ctx.db
    .from('messages')
    .update({ content_text: update.text })
    .eq('id', internalId);

  if (error) {
    console.error('[whatsmiau] could not apply the edit:', error.message);
  }
}

/**
 * The sender deleted a message. The `messages` table has no `deleted`
 * column and the Global Constraints forbid altering it, so the row is
 * turned into a tombstone: the text is replaced by `DELETED_MESSAGE_TEXT`
 * and the attachment is dropped.
 */
export async function handleWhatsmiauDeletedMessage(
  ctx: WhatsmiauInboundContext,
  update: { messageId: string; remoteJid: string; fromMe: boolean },
): Promise<void> {
  const internalId = await findMessageIdInAccount(ctx, update.messageId);
  if (!internalId) return;

  const { error } = await ctx.db
    .from('messages')
    .update({
      content_text: DELETED_MESSAGE_TEXT,
      media_url: null,
      media_type: null,
    })
    .eq('id', internalId);

  if (error) {
    console.error('[whatsmiau] could not apply the deletion:', error.message);
  }
}

/**
 * Resolve the provider's message id into the internal row id, scoped to
 * the account. `messages` has no `account_id` column — the tenancy
 * lives on `conversations`, so the scope is applied through the join,
 * the same way `message-status-sync` does it.
 */
async function findMessageIdInAccount(
  ctx: WhatsmiauInboundContext,
  messageId: string,
): Promise<string | null> {
  const { data, error } = await ctx.db
    .from('messages')
    .select('id, conversations!inner(account_id)')
    .eq('message_id', messageId)
    .eq('conversations.account_id', ctx.accountId)
    .maybeSingle();

  if (error) {
    console.error('[whatsmiau] message lookup failed:', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Resolve the audit user for the account — the member whose id is
 * stamped on the contact / conversation rows we create.
 */
export async function resolveWhatsmiauOwnerUserId(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  return resolveAuditUserId(db, accountId);
}
