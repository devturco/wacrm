// ============================================================
// The provider's own contact push (`contacts.upsert`).
//
// The provider tells us about a contact when its metadata changes —
// and it hands over the picture url in the same breath. That url
// costs us NOTHING to get: no call, no key, no waiting.
//
// The on-demand lookup (see `avatar.ts`) asks the provider for the
// picture of a contact, one message at a time. That is the belt; this
// push is the braces. When the lookup failed — a hiccup at the
// provider, a CDN url that expired, a storage that said no — the push
// is the second chance, and it arrives on its own, with no message
// needed to trigger it.
//
// Two rules keep this path safe:
//
//   1. A contact event NEVER creates a contact. Only a message does
//      that. This path only dresses a contact we already have.
//   2. A push WITHOUT a picture is not an answer. The provider does
//      not promise the field on every delivery, so "no picture here"
//      is NOT recorded as "this contact has no picture" — that would
//      freeze the lookup for a whole day over one thin delivery.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact } from '@/lib/contacts/dedupe';
import type { MediaStorage } from '@/lib/media/storage';

import { avatarFailedRecently, storeContactAvatar } from './avatar';
import type { NormalizedContactUpsert } from './normalize';

export interface ContactUpsertContext {
  db: SupabaseClient;
  accountId: string;
  /** The account's storage — the picture lands in the account's backend. */
  storage: MediaStorage;
}

/**
 * Store the picture the provider just pushed.
 *
 * Nothing here throws: the caller is the webhook, and a picture must
 * never cost a delivery.
 */
export async function handleWhatsmiauContactUpsert(
  ctx: ContactUpsertContext,
  contact: NormalizedContactUpsert,
): Promise<void> {
  // No picture in the push — nothing to do, and nothing to record.
  if (!contact.profilePicUrl) return;

  const existing = await findExistingContact(ctx.db, ctx.accountId, contact.phone);
  // A contact we do not have is not created here. The push may arrive
  // for anyone in the customer's phone book — that is not a reason to
  // fill the inbox with strangers.
  if (!existing) return;

  const contactId = typeof existing.id === 'string' ? existing.id : null;
  if (!contactId) return;

  // It already has a picture: ours is a durable copy, so a new url
  // from the provider changes nothing.
  const current = typeof existing.avatar_url === 'string' ? existing.avatar_url : '';
  if (current) return;

  // The last attempt FAILED and it was recent. Trying again now would
  // download the same picture for the same result — the on-demand path
  // is already waiting for its window.
  if (await avatarFailedRecently(ctx.db, contactId)) return;

  const stored = await storeContactAvatar({
    db: ctx.db,
    accountId: ctx.accountId,
    storage: ctx.storage,
    contactId,
    url: contact.profilePicUrl,
  });

  if (!stored.ok) {
    console.warn(
      `[whatsmiau-avatar] the pushed picture could not be stored (${stored.reason}) for the contact ${contactId}`,
    );
  }
}
