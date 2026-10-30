// ============================================================
// The contact's profile picture.
//
// The official API (Meta) does not expose it: its webhook carries the
// name and the number, and that is all — the inbox can only show an
// initial. The CRMBR API DOES expose it
// (`POST /chat/fetchProfilePictureUrl/:instance`), so the picture is
// possible here.
//
// The URL the provider hands back lives on WhatsApp's CDN and EXPIRES.
// The bytes are therefore copied into our own storage and
// `contacts.avatar_url` points at OUR object — durable, and served by
// the same backend that already carries the chat media.
//
// Everything here is BEST EFFORT, like the inbound media mirror: a
// picture is never worth losing a message over. Every failure returns
// `null` and the caller carries on.
// ============================================================

import type { MediaStorage } from '@/lib/media/storage';

import type { WhatsmiauConnection } from '../types';
import { whatsmiauRequest } from './client';

/**
 * The provider answers this in a few hundred milliseconds. A slow
 * answer is a no-answer — the inbox must not wait on a photo.
 */
export const PROFILE_PICTURE_TIMEOUT_MS = 8_000;

/**
 * WhatsApp profile pictures are small (tens of KB). 2 MB is a
 * generous ceiling that still cannot be used to fill the bucket.
 */
export const PROFILE_PICTURE_MAX_BYTES = 2 * 1024 * 1024;

/** How long the CDN download may take. */
const PROFILE_PICTURE_DOWNLOAD_TIMEOUT_MS = 10_000;

/**
 * The MIME types an image is stored as. Anything else becomes JPEG —
 * WhatsApp serves profile pictures as JPEG in practice.
 */
const ALLOWED_IMAGE_TYPES: Record<string, { mime: string; ext: string }> = {
  'image/jpeg': { mime: 'image/jpeg', ext: 'jpg' },
  'image/jpg': { mime: 'image/jpeg', ext: 'jpg' },
  'image/png': { mime: 'image/png', ext: 'png' },
  'image/webp': { mime: 'image/webp', ext: 'webp' },
  'image/gif': { mime: 'image/gif', ext: 'gif' },
};

/**
 * Pull the picture URL out of the provider's answer.
 *
 * The documented shape is `{ "profilePictureUrl": "..." }`, and the
 * value is `null` when the contact has no picture or hid it. A few
 * spellings are accepted because the provider is Evolution-compatible
 * and the field has been spelled both ways over time.
 */
export function readProfilePictureUrl(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return payload.startsWith('http') ? payload : null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.profilePictureUrl,
    record.profilePicUrl,
    record.pictureUrl,
    record.url,
    (record.data as Record<string, unknown> | undefined)?.profilePictureUrl,
    (record.data as Record<string, unknown> | undefined)?.profilePicUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.startsWith('http')) {
      return candidate;
    }
  }
  return null;
}

/**
 * Ask the provider for the contact's picture.
 *
 * `number` accepts the digits-only phone as well as the full JID —
 * the provider accepts either.
 */
export async function fetchProfilePictureUrl(
  conn: WhatsmiauConnection,
  number: string,
): Promise<string | null> {
  const payload = await whatsmiauRequest<unknown>(conn, {
    method: 'POST',
    path: `/chat/fetchProfilePictureUrl/${encodeURIComponent(conn.instanceName)}`,
    body: { number },
    timeoutMs: PROFILE_PICTURE_TIMEOUT_MS,
  });
  return readProfilePictureUrl(payload);
}

/**
 * Only `http(s)` is fetchable. Anything else (`data:`, `file:`, a
 * relative path) is refused before a request is made.
 */
export function isFetchableImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** The bucket's image type for a response's content type. */
export function imageTypeFor(contentType: string | null): { mime: string; ext: string } {
  const base = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return ALLOWED_IMAGE_TYPES[base] ?? ALLOWED_IMAGE_TYPES['image/jpeg']!;
}

export interface ProfilePictureDownload {
  buffer: Uint8Array;
  contentType: string | null;
}

/** Injected in tests; defaults to a plain GET of the CDN url. */
export type ProfilePictureDownloader = (url: string) => Promise<ProfilePictureDownload>;

/**
 * Read the body, refusing anything past the cap.
 *
 * The `content-length` header is only a hint, so the bytes are counted
 * while they arrive: a CDN that lies about the length cannot make us
 * buffer an unbounded body.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`the picture announced ${declared} bytes, over the ${maxBytes}-byte limit`);
  }

  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error('the picture is too large');
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`the picture is over the ${maxBytes}-byte limit`);
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** Default downloader: a plain GET of the CDN url, with a deadline. */
export const downloadProfilePicture: ProfilePictureDownloader = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PROFILE_PICTURE_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`the picture download failed with ${response.status}`);
  }
  const buffer = await readCapped(response, PROFILE_PICTURE_MAX_BYTES);
  return { buffer, contentType: response.headers.get('content-type') };
};

export interface MirrorProfilePictureArgs {
  /** The account's storage — Supabase bucket or R2, per `media_settings`. */
  storage: MediaStorage;
  /** The contact — the object path is keyed on it, so it is stable. */
  contactId: string;
  /** The CDN url the provider returned. */
  url: string;
  download?: ProfilePictureDownloader;
}

/**
 * Why the copy did not happen.
 *
 * The reason travels with the result so the caller can tell a
 * transient failure (worth retrying soon) from a final answer ("this
 * contact has no picture") — and so the log says WHICH step broke,
 * instead of a single "it failed".
 */
export type ProfilePictureFailure =
  /** The provider handed back something that is not an http(s) url. */
  | 'unusable_url'
  /** The CDN download failed — the url expired, or the network did. */
  | 'download_failed'
  /** The download worked but the body was empty. */
  | 'empty_picture'
  /** The picture is bigger than the cap. */
  | 'picture_too_large'
  /** The storage backend refused the write. */
  | 'storage_failed'
  /** The storage took the object but gave back no public url. */
  | 'no_public_url';

export type MirrorProfilePictureResult =
  | {
      ok: true;
      /** The durable public URL of the stored object. */
      publicUrl: string;
      /** The object's path inside the bucket. */
      path: string;
    }
  | { ok: false; reason: ProfilePictureFailure };

/**
 * Copy the picture into the account's storage.
 *
 * The path is keyed on the contact id, so a second attempt overwrites
 * the same object instead of littering the bucket.
 *
 * @returns the stored object, or the reason it could not be stored.
 */
export async function mirrorProfilePicture(
  args: MirrorProfilePictureArgs,
): Promise<MirrorProfilePictureResult> {
  const {
    storage,
    contactId,
    url,
    download = downloadProfilePicture,
  } = args;

  if (!isFetchableImageUrl(url)) {
    console.warn('[whatsmiau-avatar] the provider returned an unusable picture url');
    return { ok: false, reason: 'unusable_url' };
  }

  let bytes: Uint8Array;
  let contentType: string | null;
  try {
    const downloaded = await download(url);
    bytes = downloaded.buffer;
    contentType = downloaded.contentType;
  } catch (error) {
    console.warn(
      '[whatsmiau-avatar] could not download the picture:',
      error instanceof Error ? error.message : error,
    );
    return { ok: false, reason: 'download_failed' };
  }

  if (bytes.byteLength === 0) {
    console.warn('[whatsmiau-avatar] the picture came back empty');
    return { ok: false, reason: 'empty_picture' };
  }
  if (bytes.byteLength > PROFILE_PICTURE_MAX_BYTES) {
    console.warn(
      `[whatsmiau-avatar] skipping the picture: ${bytes.byteLength} bytes exceeds the ${PROFILE_PICTURE_MAX_BYTES}-byte limit`,
    );
    return { ok: false, reason: 'picture_too_large' };
  }

  const type = imageTypeFor(contentType);

  try {
    // The contact's own picture, in the account's avatar folder. The
    // contact id in the name keeps it stable: a second attempt
    // overwrites the same object instead of littering the bucket.
    const path = storage.pathFor({
      folder: 'avatar',
      fileName: `${contactId}.${type.ext}`,
    });
    const { publicUrl } = await storage.put({
      path,
      body: bytes,
      contentType: type.mime,
      cacheControl: '3600',
      upsert: true,
    });
    if (!publicUrl) {
      console.warn('[whatsmiau-avatar] the storage accepted the picture but gave back no public url');
      return { ok: false, reason: 'no_public_url' };
    }
    return { ok: true, publicUrl, path };
  } catch (error) {
    console.warn(
      '[whatsmiau-avatar] could not mirror the picture:',
      error instanceof Error ? error.message : error,
    );
    return { ok: false, reason: 'storage_failed' };
  }
}
