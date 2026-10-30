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
// BEST EFFORT throughout: a missing picture must never cost a message.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { MediaStorage } from '@/lib/media/storage';
import type { WhatsmiauConnection } from '../types';

import { fetchProfilePictureUrl, mirrorProfilePicture } from './profile-picture';

/**
 * How long we wait before asking the provider about a contact again.
 *
 * A day is short enough that a picture the customer adds later shows
 * up, and long enough that a busy contact does not cost a call per
 * message.
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
 * Make sure the contact has a picture, asking the provider only when
 * it is worth asking.
 *
 * Nothing here throws: the caller is the inbound pipeline, and a
 * picture must never cost a message.
 */
export async function refreshContactAvatar(
  args: RefreshContactAvatarArgs,
): Promise<void> {
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
  if (currentAvatarUrl) return;

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
  } else if (
    record &&
    record.status !== 'found' &&
    now.getTime() - record.checkedAt < AVATAR_RECHECK_AFTER_MS
  ) {
    // Asked recently, and there was no picture to be found.
    return;
  }

  let pictureUrl: string | null = null;
  try {
    pictureUrl = await fetchProfilePictureUrl(conn, phone);
  } catch (error) {
    // A provider failure is NOT "the contact has no picture". We record
    // the attempt as `pending` so the next message tries again after
    // the window, and we say what went wrong in the log.
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
    return;
  }

  if (!pictureUrl) {
    await writeAvatarRecord(db, {
      contactId,
      accountId,
      status: 'missing',
      storagePath: null,
      now,
    });
    return;
  }

  const mirrored = await mirrorProfilePicture({
    storage,
    accountId,
    contactId,
    url: pictureUrl,
  });

  if (!mirrored) {
    // The bytes could not be copied. Try again after the window.
    await writeAvatarRecord(db, {
      contactId,
      accountId,
      status: 'pending',
      storagePath: null,
      now,
    });
    return;
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
    return;
  }

  await writeAvatarRecord(db, {
    contactId,
    accountId,
    status: 'found',
    storagePath: mirrored.path,
    now,
  });
}
