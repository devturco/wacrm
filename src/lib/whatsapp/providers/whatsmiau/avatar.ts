// ============================================================
// The contact's picture — when to ask the provider for it.
//
// The provider knows the picture; the app has to fetch it ONCE per
// contact and keep the bytes in our own bucket (see
// `profile-picture.ts`). The question this module answers is WHEN to
// ask — because asking costs a call, and most contacts have no
// picture at all (hidden by privacy, or simply never set one).
//
// The `contact_avatars` table (migration 065) holds the answer: the
// last check and its outcome. A contact that has no picture is asked
// about once a day, not once per message.
//
// The two states need DIFFERENT windows, and that is the whole point:
//
//   `missing` — the provider answered "this contact has no picture".
//                That is an ANSWER, so it is asked about rarely (a day).
//   `pending` — the attempt FAILED (the provider was down, the CDN url
//                expired, the storage refused the write). That is NOT
//                an answer, so it is asked about soon (15 min). The
//                first version used a day for both, and a hiccup on a
//                brand-new account cost every contact its picture for
//                a whole day — with nothing to wake it up.
//
// BEST EFFORT throughout: a missing picture must never cost a message.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { MediaStorage } from '@/lib/media/storage';
import type { WhatsmiauConnection } from '../types';

import {
  fetchProfilePictureUrl,
  mirrorProfilePicture,
  type ProfilePictureFailure,
} from './profile-picture';

/**
 * How long we wait before asking again about a contact whose attempt
 * FAILED.
 *
 * A failure is not an answer — the provider was down, the CDN url had
 * expired, the storage refused the write. Freezing it for a day (what
 * the first version did) meant a transient hiccup cost the contact
 * its picture for a day, and nothing ever asked again: the retry only
 * happens when the contact writes.
 */
export const AVATAR_RETRY_AFTER_MS = 15 * 60 * 1000;

/**
 * How long we wait before asking again about a contact the provider
 * says has NO picture.
 *
 * This one IS an answer, so the window is long: the picture only
 * changes when the customer sets one, and a day is soon enough.
 */
export const AVATAR_RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

export type AvatarStatus = 'pending' | 'found' | 'missing';

interface AvatarRecord {
  status: AvatarStatus;
  checkedAt: number;
}

/** Postgres' "relation does not exist" — the migration was not applied. */
const UNDEFINED_TABLE = '42P01';

let warnedAboutMissingTable = false;

/** Why the lookup did not happen at all. */
export type AvatarSkipReason =
  /** The contact already has a picture — there is nothing to look for. */
  | 'already_has_avatar'
  /** Asked recently; the window has not passed yet. */
  | 'not_due';

/** Why the lookup happened and produced no picture. */
export type AvatarFailureReason =
  /** The provider call itself failed (network, auth, unknown endpoint). */
  | 'provider_error'
  /** The picture could not be copied into our storage. */
  | ProfilePictureFailure
  /** The picture was copied, but the contact row could not be updated. */
  | 'db_error';

export type AvatarOutcome =
  | { status: 'skipped'; reason: AvatarSkipReason }
  | { status: 'found'; publicUrl: string }
  | { status: 'missing' }
  | { status: 'failed'; reason: AvatarFailureReason };

export interface RefreshContactAvatarArgs {
  db: SupabaseClient;
  accountId: string;
  /** The account's storage — the picture lands in the account's backend. */
  storage: MediaStorage;
  conn: WhatsmiauConnection;
  contactId: string;
  /** Digits-only phone (or the full JID — the provider accepts both). */
  phone: string;
  /** The contact's current avatar — when set, there is nothing to do. */
  currentAvatarUrl?: string | null;
  now?: Date;
}

/**
 * Read what we already know about this contact's picture.
 *
 * `null` when nothing was recorded yet; `'table-missing'` when the
 * migration has not been applied on this database.
 */
async function readAvatarRecord(
  db: SupabaseClient,
  contactId: string,
): Promise<AvatarRecord | null | 'table-missing'> {
  const { data, error } = await db
    .from('contact_avatars')
    .select('status, checked_at')
    .eq('contact_id', contactId)
    .maybeSingle();

  if (error) {
    if (error.code === UNDEFINED_TABLE) return 'table-missing';
    console.warn('[whatsmiau-avatar] could not read the avatar record:', error.message);
    return null;
  }
  if (!data) return null;

  const row = data as { status?: string; checked_at?: string };
  const status: AvatarStatus =
    row.status === 'found' || row.status === 'missing' ? row.status : 'pending';
  const checkedAt = row.checked_at ? Date.parse(row.checked_at) : 0;
  return { status, checkedAt: Number.isFinite(checkedAt) ? checkedAt : 0 };
}

/** Write down what we learned about this contact's picture. */
async function writeAvatarRecord(
  db: SupabaseClient,
  args: {
    contactId: string;
    accountId: string;
    status: AvatarStatus;
    storagePath: string | null;
    now: Date;
  },
): Promise<void> {
  const { contactId, accountId, status, storagePath, now } = args;
  const payload = {
    contact_id: contactId,
    account_id: accountId,
    status,
    storage_path: storagePath,
    checked_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const { error } = await db
    .from('contact_avatars')
    .upsert(payload, { onConflict: 'contact_id' });

  if (error) {
    if (error.code !== UNDEFINED_TABLE) {
      console.warn('[whatsmiau-avatar] could not record the avatar check:', error.message);
    }
  }
}

/**
 * Is it time to ask the provider about this contact again?
 *
 * `found` is always due: the picture was copied before, so the contact
 * HAS one — if the contact row no longer points at it, the row lost it
 * and the picture has to be fetched again.
 */
function isDue(record: AvatarRecord, now: Date): boolean {
  if (record.status === 'found') return true;
  const elapsed = now.getTime() - record.checkedAt;
  const window =
    record.status === 'missing' ? AVATAR_RECHECK_AFTER_MS : AVATAR_RETRY_AFTER_MS;
  return elapsed >= window;
}

export interface StoreContactAvatarArgs {
  db: SupabaseClient;
  accountId: string;
  storage: MediaStorage;
  contactId: string;
  /** The provider's picture url — it expires, so the bytes are copied. */
  url: string;
  now?: Date;
}

/**
 * True when this contact was looked for recently and the attempt FAILED.
 *
 * The on-demand path honours the window on its own. The push path
 * needs this too: a storage that says no would otherwise turn every
 * push into a download of the same picture.
 */
export async function avatarFailedRecently(
  db: SupabaseClient,
  contactId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const record = await readAvatarRecord(db, contactId);
  if (record === 'table-missing' || !record) return false;
  if (record.status !== 'pending') return false;
  return now.getTime() - record.checkedAt < AVATAR_RETRY_AFTER_MS;
}

export type StoreContactAvatarOutcome =
  | { ok: true; publicUrl: string; path: string }
  | { ok: false; reason: AvatarFailureReason };

/**
 * Copy the picture into the account's storage and point the contact at
 * it.
 *
 * This is the ONE place that writes `contacts.avatar_url`, so the
 * on-demand lookup and the provider's own push cannot drift apart.
 *
 * @returns the stored object, or the reason it could not be stored.
 */
export async function storeContactAvatar(
  args: StoreContactAvatarArgs,
): Promise<StoreContactAvatarOutcome> {
  const { db, accountId, storage, contactId, url, now = new Date() } = args;

  const mirrored = await mirrorProfilePicture({ storage, contactId, url });

  if (!mirrored.ok) {
    // The bytes could not be copied. Recorded as `pending`, so the next
    // attempt happens soon instead of a day from now.
    await writeAvatarRecord(db, {
      contactId,
      accountId,
      status: 'pending',
      storagePath: null,
      now,
    });
    return { ok: false, reason: mirrored.reason };
  }

  const { error: updateError } = await db
    .from('contacts')
    .update({ avatar_url: mirrored.publicUrl })
    .eq('id', contactId)
    .eq('account_id', accountId);

  if (updateError) {
    console.warn('[whatsmiau-avatar] could not store the picture:', updateError.message);
    await writeAvatarRecord(db, {
      contactId,
      accountId,
      status: 'pending',
      storagePath: mirrored.path,
      now,
    });
    return { ok: false, reason: 'db_error' };
  }

  await writeAvatarRecord(db, {
    contactId,
    accountId,
    status: 'found',
    storagePath: mirrored.path,
    now,
  });

  return { ok: true, publicUrl: mirrored.publicUrl, path: mirrored.path };
}

/**
 * Make sure the contact has a picture, asking the provider only when
 * it is worth asking.
 *
 * Nothing here throws: the caller is the inbound pipeline, and a
 * picture must never cost a message.
 *
 * @returns what happened, so the caller (and the log) says WHICH step
 *          broke instead of a single "it failed".
 */
export async function refreshContactAvatar(
  args: RefreshContactAvatarArgs,
): Promise<AvatarOutcome> {
  const {
    db,
    accountId,
    storage,
    conn,
    contactId,
    phone,
    currentAvatarUrl,
    now = new Date(),
  } = args;

  // The contact already has a picture — there is nothing to look for.
  if (currentAvatarUrl) return { status: 'skipped', reason: 'already_has_avatar' };

  const record = await readAvatarRecord(db, contactId);

  if (record === 'table-missing') {
    // The migration has not been applied: we cannot remember what we
    // learned, so we ask on every message. It still works — it is just
    // chatty. Say so, once.
    if (!warnedAboutMissingTable) {
      warnedAboutMissingTable = true;
      console.warn(
        '[whatsmiau-avatar] the contact_avatars table is missing — run migration 065 to stop asking the provider on every message.',
      );
    }
  } else if (record && !isDue(record, now)) {
    // Asked recently. A failure comes back sooner than an answer.
    return { status: 'skipped', reason: 'not_due' };
  }

  let pictureUrl: string | null = null;
  try {
    pictureUrl = await fetchProfilePictureUrl(conn, phone);
  } catch (error) {
    // A provider failure is NOT "the contact has no picture". We record
    // the attempt as `pending` so the next message tries again soon,
    // and we say what went wrong in the log.
    console.warn(
      '[whatsmiau-avatar] could not ask the provider for the picture:',
      error instanceof Error ? error.message : error,
    );
    await writeAvatarRecord(db, {
      contactId,
      accountId,
      status: 'pending',
      storagePath: null,
      now,
    });
    return { status: 'failed', reason: 'provider_error' };
  }

  if (!pictureUrl) {
    await writeAvatarRecord(db, {
      contactId,
      accountId,
      status: 'missing',
      storagePath: null,
      now,
    });
    return { status: 'missing' };
  }

  const stored = await storeContactAvatar({
    db,
    accountId,
    storage,
    contactId,
    url: pictureUrl,
    now,
  });

  if (!stored.ok) {
    console.warn(
      `[whatsmiau-avatar] the picture could not be stored (${stored.reason}) for the contact ${contactId}`,
    );
    return { status: 'failed', reason: stored.reason };
  }

  return { status: 'found', publicUrl: stored.publicUrl };
}
