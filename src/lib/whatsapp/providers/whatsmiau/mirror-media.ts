// ============================================================
// WhatsMiau inbound media mirror.
//
// The Meta path (`mirrorInboundMedia`) downloads the bytes with the
// account's access token, because Meta's media urls are token-scoped.
// WhatsMiau hands us a PUBLIC url (`data.message.mediaUrl`) whenever the
// instance runs with `saveMedia` on — there is nothing to sign, we just
// fetch it.
//
// Either way the bytes have to land in our own `chat-media` bucket: the
// provider's url expires, and an attachment that quietly rots into
// "unavailable" is exactly the failure this module exists to prevent
// (issue #466).
//
// BEST EFFORT, like the Meta mirror: any failure returns `null` and the
// caller keeps the provider's url, which still works for as long as the
// provider holds the bytes.
// ============================================================

import {
  MIRROR_BUCKET,
  MIRROR_FOLDER,
  mirrorFileName,
  normalizeMimeType,
  type MirrorStorage,
} from '@/lib/whatsapp/mirror-inbound-media';
import { MEDIA_MAX_BYTES, buildMediaPath } from '@/lib/storage/upload-media';

export interface WhatsmiauMediaDownload {
  buffer: Uint8Array;
  contentType: string | null;
}

/** Injected in tests; defaults to a plain GET of the public url. */
export type WhatsmiauMediaDownloader = (url: string) => Promise<WhatsmiauMediaDownload>;

export interface MirrorWhatsmiauMediaArgs {
  storage: MirrorStorage;
  accountId: string;
  /** The provider's message id — makes the object path deterministic. */
  mediaId: string;
  /** Public url from `data.message.mediaUrl`. */
  mediaUrl?: string | null;
  /** Raw base64, when the instance runs with `webhook.base64: true`. */
  mediaBase64?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  messageTimestamp?: number | null;
  download?: WhatsmiauMediaDownloader;
}

/** Decode base64 into bytes. Returns null when the payload is not base64. */
function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Default downloader: a plain GET of the public url. */
export const downloadWhatsmiauMedia: WhatsmiauMediaDownloader = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WhatsMiau media download failed with ${response.status}`);
  }
  const contentType = response.headers.get('content-type');
  const buffer = new Uint8Array(await response.arrayBuffer());
  return { buffer, contentType };
};

/**
 * Copy an inbound WhatsMiau attachment into `chat-media`.
 *
 * @returns the durable public URL, or `null` when the mirror was
 *          skipped or failed — in which case the caller keeps the
 *          provider's own url.
 */
export async function mirrorWhatsmiauMedia(
  args: MirrorWhatsmiauMediaArgs,
): Promise<string | null> {
  const {
    storage,
    accountId,
    mediaId,
    mediaUrl,
    mediaBase64,
    mimeType,
    fileName,
    messageTimestamp,
    download = downloadWhatsmiauMedia,
  } = args;

  const normalizedMime = normalizeMimeType(mimeType);

  let bytes: Uint8Array | null = null;
  let contentType: string | null = null;

  if (mediaUrl) {
    try {
      const downloaded = await download(mediaUrl);
      bytes = downloaded.buffer;
      contentType = downloaded.contentType;
    } catch (error) {
      console.warn('[whatsmiau-mirror] download failed for', mediaId, error);
      return null;
    }
  } else if (mediaBase64) {
    bytes = decodeBase64(mediaBase64);
    if (!bytes) {
      console.warn('[whatsmiau-mirror] could not decode the base64 media for', mediaId);
      return null;
    }
  } else {
    return null;
  }

  if (bytes.byteLength > MEDIA_MAX_BYTES) {
    console.warn(
      `[whatsmiau-mirror] skipping ${mediaId}: ${bytes.byteLength} bytes exceeds the ${MEDIA_MAX_BYTES}-byte bucket limit`,
    );
    return null;
  }

  // The metadata MIME wins over the response header: it is what the
  // message row records, so the stored object and `media_type` describe
  // the same thing.
  const uploadType =
    normalizedMime ?? normalizeMimeType(contentType) ?? 'application/octet-stream';

  try {
    const objectName = mirrorFileName({
      mediaId,
      mimeType: uploadType,
      fileName,
      messageTimestamp,
    });
    // `null` suppresses buildMediaPath's wall-clock stamp: the media id
    // already makes the path unique AND stable, and the stability is
    // what makes a redelivery idempotent instead of duplicative.
    const path = buildMediaPath(accountId, objectName, null, MIRROR_FOLDER);

    const { error } = await storage.from(MIRROR_BUCKET).upload(path, bytes, {
      contentType: uploadType,
      cacheControl: '3600',
      upsert: true,
    });
    if (error) {
      console.warn(
        `[whatsmiau-mirror] upload failed for ${mediaId} (${uploadType}):`,
        error.message,
      );
      return null;
    }

    const {
      data: { publicUrl },
    } = storage.from(MIRROR_BUCKET).getPublicUrl(path);
    return publicUrl || null;
  } catch (error) {
    console.warn('[whatsmiau-mirror] could not mirror', mediaId, error);
    return null;
  }
}
