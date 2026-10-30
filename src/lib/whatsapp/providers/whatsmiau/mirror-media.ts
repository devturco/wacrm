// ============================================================
// WhatsMiau inbound media mirror.
//
// The Meta path (`mirrorInboundMedia`) downloads the bytes with the
// account's access token, because Meta's media urls are token-scoped.
// WhatsMiau hands us a PUBLIC url (`data.message.mediaUrl`) whenever the
// instance runs with `saveMedia` on — there is nothing to sign, we just
// fetch it.
//
// Either way the bytes have to land in our OWN storage: the provider's
// url expires, and an attachment that quietly rots into "unavailable" is
// exactly the failure this module exists to prevent (issue #466).
//
// WHERE that storage is, is the account's choice (`media_settings`) —
// Supabase bucket or R2 — the same place the composer uploads to. The
// rows written before the switch keep their old URLs and keep working;
// nothing is copied or deleted to make room for the new backend.
//
// BEST EFFORT, like the Meta mirror: any failure returns `null` and the
// caller keeps the provider's url, which still works for as long as the
// provider holds the bytes.
// ============================================================

import {
  mirrorFileName,
  mirrorObjectPath,
  normalizeMimeType,
} from '@/lib/whatsapp/mirror-inbound-media';
import type { MediaStorage } from '@/lib/media/storage';
import { normalizeContentType } from '@/lib/media/content-type';
import { contentLengthOf } from '@/lib/media/content-length';
import { CHAT_MEDIA_MAX_BYTES } from '@/lib/storage/upload-media';

export interface WhatsmiauMediaDownload {
  stream: ReadableStream<Uint8Array>;
  contentType: string | null;
  /**
   * How many bytes the body holds, when the provider's response says so.
   *
   * R2's S3 API refuses a PUT whose length it cannot know, so the
   * length travels with the download: a stream without it goes out as
   * `Transfer-Encoding: chunked` and the bucket answers "length
   * required" — the attachment then stays on the provider's server.
   */
  contentLength?: number | null;
}

/** Injected in tests; defaults to a plain GET of the public url. */
export type WhatsmiauMediaDownloader = (
  url: string,
  maxBytes: number,
) => Promise<WhatsmiauMediaDownload>;

export interface MirrorWhatsmiauMediaArgs {
  /** The account's storage — Supabase bucket or R2, per `media_settings`. */
  storage: MediaStorage;
  /** The provider's message id — makes the object path deterministic. */
  mediaId: string;
  /** Public url from `data.message.mediaUrl`. */
  mediaUrl?: string | null;
  /** Raw base64, when the instance runs with `webhook.base64: true`. */
  mediaBase64?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  messageTimestamp?: number | null;
  /** Ceiling in bytes — the account's, capped by the bucket's 100 MB. */
  maxBytes?: number;
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

/**
 * Default downloader: a plain GET of the public url.
 *
 * The bytes are counted as they arrive and the stream is cut at the
 * limit, so a 100 MB attachment never lands in memory whole.
 */
export const downloadWhatsmiauMedia: WhatsmiauMediaDownloader = async (
  url,
  maxBytes,
) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WhatsMiau media download failed with ${response.status}`);
  }
  const contentType = response.headers.get('content-type');
  if (!response.body) {
    throw new Error('WhatsMiau media download returned no body');
  }

  const reader = response.body.getReader();
  let seen = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      seen += value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel();
        controller.error(new Error(`Media exceeds the ${maxBytes}-byte limit`));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { stream, contentType, contentLength: contentLengthOf(response) };
};

/**
 * Copy an inbound WhatsMiau attachment into the account's storage.
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
    mediaId,
    mediaUrl,
    mediaBase64,
    mimeType,
    fileName,
    messageTimestamp,
    // The account's ceiling, capped by what the bucket accepts.
    maxBytes = Math.min(storage.maxFileBytes, CHAT_MEDIA_MAX_BYTES),
    download = downloadWhatsmiauMedia,
  } = args;

  const normalizedMime = normalizeMimeType(mimeType);

  let body: ReadableStream<Uint8Array> | Uint8Array | null = null;
  let contentType: string | null = null;
  // How many bytes the body holds. The bucket needs to know: a stream
  // whose length nobody declared goes out as `Transfer-Encoding:
  // chunked`, and R2 refuses it ("length required") — the attachment
  // then stays on the provider's own server, which is exactly what the
  // mirror exists to prevent.
  let contentLength: number | null = null;

  if (mediaUrl) {
    try {
      const downloaded = await download(mediaUrl, maxBytes);
      body = downloaded.stream;
      contentType = downloaded.contentType;
      contentLength = downloaded.contentLength ?? null;
    } catch (error) {
      console.warn('[whatsmiau-mirror] download failed for', mediaId, error);
      return null;
    }
  } else if (mediaBase64) {
    const bytes = decodeBase64(mediaBase64);
    if (!bytes) {
      console.warn('[whatsmiau-mirror] could not decode the base64 media for', mediaId);
      return null;
    }
    if (bytes.byteLength > maxBytes) {
      console.warn(
        `[whatsmiau-mirror] skipping ${mediaId}: ${bytes.byteLength} bytes exceeds the ${maxBytes}-byte limit`,
      );
      return null;
    }
    body = bytes;
    contentLength = bytes.byteLength;
  } else {
    return null;
  }

  // The metadata MIME wins over the response header: it is what the
  // message row records, so the stored object and `media_type` describe
  // the same thing. The type we DECLARE is normalised — the bucket only
  // accepts a known list, and anything unknown is stored as
  // `application/octet-stream` so the browser downloads it.
  const sourceMime = normalizedMime ?? normalizeMimeType(contentType);
  const uploadType = normalizeContentType(sourceMime);

  try {
    const objectName = mirrorFileName({
      mimeType: sourceMime,
      fileName,
      messageTimestamp,
    });
    const path = mirrorObjectPath(
      storage,
      mediaId,
      objectName,
      messageTimestamp,
    );

    const { publicUrl } = await storage.put({
      path,
      body,
      contentType: uploadType,
      contentLength: contentLength ?? undefined,
      cacheControl: '3600',
      upsert: true,
    });
    return publicUrl || null;
  } catch (error) {
    console.warn('[whatsmiau-mirror] could not mirror', mediaId, error);
    return null;
  }
}
