import { downloadMediaStream } from "./meta-api";
import { extensionForMime } from "@/lib/media/filename";
import { normalizeContentType } from "@/lib/media/content-type";
import type { MediaStorage } from "@/lib/media/storage";
import { buildMediaPath, CHAT_MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";

/**
 * Copies inbound WhatsApp media into the account's OWN storage so it
 * outlives Meta's retention window (issue #466).
 *
 * Meta deletes media roughly 30 days after receipt. Before this, the
 * webhook stored only a pointer — `/api/whatsapp/media/<mediaId>` — and
 * the proxy route behind it re-fetched from Meta on every single view,
 * so an attachment quietly became unviewable a month after it arrived.
 * Outbound media never had the problem: the composer uploads to the
 * account's storage (migration 023) and stores a durable public URL.
 * This puts inbound on the same footing.
 *
 * WHERE the bytes land is the account's choice (`media_settings`): the
 * Supabase `chat-media` bucket or Cloudflare R2. The mirror follows
 * that choice — the same one the composer already obeys. This used to
 * be hardcoded to the Supabase bucket, so an account that had chosen
 * R2 still received every incoming photo there.
 *
 * The history is NOT rewritten: `media_url` keeps the full public URL
 * of whatever backend served the attachment, and the objects already in
 * the Supabase bucket stay exactly where they are. A row written before
 * the switch keeps pointing at the Supabase URL and keeps rendering.
 *
 * Everything here is BEST EFFORT and returns `null` rather than
 * throwing. The caller is the Meta webhook, and a webhook that starts
 * failing is worse than an attachment that expires: Meta retries the
 * delivery, which re-runs contact creation, flows, automations and AI
 * replies. On any failure — oversized file, MIME the bucket refuses,
 * storage outage — the caller keeps the proxy URL, which still works
 * for as long as Meta holds the bytes.
 */

/**
 * Second path segment for mirrored inbound objects, so a bucket listing
 * separates "things a customer sent us" from "things we sent". RLS only
 * matches on the FIRST segment (`account-<id>`, migration 023), so an
 * extra level is free.
 */
export const MIRROR_FOLDER = "inbound";

export interface MirrorInboundMediaArgs {
  /**
   * The account's storage — Supabase bucket or R2, per `media_settings`.
   * The mirror writes wherever the composer writes, so both directions
   * of a conversation land in the same place.
   */
  storage: MediaStorage;
  /** Tenant. Drives the account-scoped path the bucket's policies expect. */
  accountId: string;
  /** Meta's media id. Makes the object path deterministic. */
  mediaId: string;
  /** Short-lived CDN URL from `getMediaUrl`. */
  downloadUrl: string;
  accessToken: string;
  /** Meta's `mime_type` for the media. */
  mimeType?: string | null;
  /** Meta's `file_size`, when it gave us one — lets us skip before downloading. */
  fileSize?: number | null;
  /** `document.filename`, when the sender's client supplied one. */
  fileName?: string | null;
  /** Meta's message timestamp (epoch SECONDS) — keeps download names distinct. */
  messageTimestamp?: string | number | null;
  /** Ceiling in bytes — the account's, capped by the bucket's 100 MB. */
  maxBytes?: number;
  /** Injected in tests. */
  download?: typeof downloadMediaStream;
}

/**
 * Lower-case a MIME type and drop its parameters, so `audio/ogg;
 * codecs=opus` — which is what Meta actually sends for a voice note —
 * is matched against the bucket's allow-list as plain `audio/ogg`.
 * Returns null for anything unusable.
 */
export function normalizeMimeType(value?: string | null): string | null {
  if (!value) return null;
  const base = value.split(";")[0].trim().toLowerCase();
  return base.includes("/") ? base : null;
}

/**
 * Coarse noun for a MIME type, used to build a readable download name.
 * Deliberately matches the `content_type` vocabulary in the UI rather
 * than the MIME top-level (`application/*` reads as "document").
 */
function kindForMime(mimeType: string | null): string {
  if (!mimeType) return "file";
  const [top] = mimeType.split("/");
  if (top === "image" || top === "video" || top === "audio") return top;
  if (top === "text" || top === "application") return "document";
  return "file";
}

/**
 * The object's filename inside the account folder. Pure, so the naming
 * rules can be tested without a Storage client.
 *
 * The media id is NOT part of the name — it is a path segment of its
 * own (`mirrorObjectPath`). That way the last segment of the URL is the
 * name the agent sees when downloading, with nothing to strip, and the
 * name survives whatever shape the provider's id has (Meta's long digit
 * string, the other provider's alphanumeric one).
 *
 * Names are kept short on purpose: `buildMediaPath` caps the basename it
 * receives at 40 characters. Hence `image-<epoch>` rather than
 * `whatsapp-image-<epoch>` — the latter truncates.
 */
export function mirrorFileName(args: {
  mimeType: string | null;
  fileName?: string | null;
  messageTimestamp?: string | number | null;
}): string {
  const { mimeType, fileName, messageTimestamp } = args;
  const ext = extensionForMime(mimeType);

  // A document's own name is the best download name there is, so keep
  // it. Strip any directory part and its extension — `buildMediaPath`
  // re-derives the extension from whatever we hand it, and we'd rather
  // that come from the MIME type than from a sender-controlled string.
  const stem = (fileName ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, "")
    .trim();
  if (stem) return `${stem}.${ext}`;

  // Otherwise synthesise. The message timestamp is in the name so that
  // saving two photos out of one thread doesn't produce two files with
  // the same name — and it's the provider's timestamp, not the clock,
  // so the path stays deterministic across a redelivery.
  const kind = kindForMime(mimeType);
  const stamp = String(messageTimestamp ?? "").replace(/\D/g, "");
  return `${stamp ? `${kind}-${stamp}` : kind}.${ext}`;
}

/**
 * The full object path of a mirrored attachment.
 *
 *   account-<uuid>/inbound/<media id>/<name>.<ext>
 *
 * The id sits in its own segment so it keeps the path unique and
 * stable — a redelivery rewrites the same object instead of orphaning
 * a second copy — without ever ending up in the name the agent sees.
 * The bucket's RLS only matches the FIRST segment, so the extra levels
 * are free.
 */
export function mirrorObjectPath(
  accountId: string,
  mediaId: string,
  objectName: string,
): string {
  const safeId = (mediaId ?? "").replace(/[^a-zA-Z0-9_-]+/g, "_") || "media";
  return buildMediaPath(
    accountId,
    objectName,
    null,
    `${MIRROR_FOLDER}/${safeId}`,
  );
}

/**
 * Download the bytes from Meta and put them in the account's storage.
 *
 * @returns the durable public URL, or `null` if the mirror was skipped
 *          or failed — in which case the caller must fall back to the
 *          proxy URL.
 */
export async function mirrorInboundMedia(
  args: MirrorInboundMediaArgs,
): Promise<string | null> {
  const {
    storage,
    accountId,
    mediaId,
    downloadUrl,
    accessToken,
    mimeType,
    fileSize,
    fileName,
    messageTimestamp,
    // The account's ceiling, capped by what the bucket accepts.
    maxBytes = Math.min(storage.maxFileBytes, CHAT_MEDIA_MAX_BYTES),
    download = downloadMediaStream,
  } = args;

  const normalizedMime = normalizeMimeType(mimeType);

  // Skip oversized media BEFORE spending the transfer. The bucket
  // rejects anything past its `file_size_limit` anyway, and Meta allows
  // documents up to 100 MB, so this is a real case rather than a
  // defensive one.
  if (typeof fileSize === "number" && fileSize > maxBytes) {
    console.warn(
      `[mirror-media] skipping ${mediaId}: ${fileSize} bytes exceeds the ${maxBytes}-byte limit`,
    );
    return null;
  }

  try {
    const { stream, contentType } = await download({
      downloadUrl,
      accessToken,
      maxBytes,
    });

    // Meta's metadata MIME wins over the CDN response header: it's what
    // the message row records, so mirroring it keeps `media_type` and
    // the stored object describing the same thing. The type we DECLARE
    // is normalised though: the bucket only accepts a known list, and
    // anything unknown is stored as `application/octet-stream` so the
    // browser downloads it instead of rendering it.
    const sourceMime = normalizedMime ?? normalizeMimeType(contentType);
    const uploadType = normalizeContentType(sourceMime);

    const objectName = mirrorFileName({
      mimeType: sourceMime,
      fileName,
      messageTimestamp,
    });
    const path = mirrorObjectPath(accountId, mediaId, objectName);

    // `upsert: true` for the same reason the path is stable: on the
    // rare Meta redelivery the second pass rewrites byte-identical
    // content at the same key instead of erroring or orphaning a
    // duplicate.
    let publicUrl: string;
    try {
      ({ publicUrl } = await storage.put({
        path,
        body: stream,
        contentType: uploadType,
        cacheControl: "3600",
        upsert: true,
      }));
    } catch (error) {
      console.warn(
        `[mirror-media] upload failed for ${mediaId} (${uploadType}):`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }

    return publicUrl || null;
  } catch (error) {
    console.warn(
      `[mirror-media] could not mirror ${mediaId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
