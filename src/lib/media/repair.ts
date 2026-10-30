// ============================================================
// Repair of an attachment the provider still holds.
//
// The inbound mirror (migration 066 and onwards) copies every attachment
// into our own bucket, so a conversation keeps its media after the
// provider drops it. Attachments that arrived BEFORE the mirror — and
// every mirror that failed — still point at the provider's url, which
// expires.
//
// This module takes one of those rows and copies the bytes into the
// bucket, rewriting `messages.media_url` with the durable url. It is
// called on demand (the "Restore" button), never in the background: the
// provider may simply no longer have the bytes, and there is nothing to
// restore then.
//
// Two shapes of `media_url` reach here:
//
//   1. `/api/whatsapp/media/<mediaId>` — the official provider's
//      token-scoped proxy. The bytes come with the account's access
//      token, in two steps: resolve the download url, then fetch it.
//
//   2. an absolute url on the provider's own host — the unofficial
//      provider hands us a public url. A plain GET fetches it.
//
// The provider is NEVER named in an error message: the customer sees
// "the attachment is gone", not which vendor is behind the line.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";
import { downloadMediaStream, getMediaUrl } from "@/lib/whatsapp/meta-api";
import { downloadWhatsmiauMedia } from "@/lib/whatsapp/providers/whatsmiau/mirror-media";
import {
  mirrorFileName,
  mirrorObjectPath,
  normalizeMimeType,
} from "@/lib/whatsapp/mirror-inbound-media";
import { normalizeContentType } from "@/lib/media/content-type";
import { mediaStorageFor, readMediaSettings } from "@/lib/media/storage";
import type { MediaStorage } from "@/lib/media/storage";
import { CHAT_MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";

/** The proxy url the official provider's media used to point at. */
const PROXY_PREFIX = "/api/whatsapp/media/";

/** Why a repair could not be done. */
export type RepairFailure =
  /** The message is not there, or belongs to another account. */
  | "not-found"
  /** The message has no attachment to restore. */
  | "no-media"
  /** The account has no provider connection for the official provider. */
  | "no-config"
  /** The provider no longer holds the bytes. */
  | "provider-missing"
  /** The attachment is bigger than the account's ceiling. */
  | "too-large"
  /** Storage or the row update failed. */
  | "failed";

export type RepairOutcome =
  | { ok: true; url: string; repaired: boolean }
  | { ok: false; reason: RepairFailure };

/** The pieces that talk to the outside world — injected in tests. */
export interface RepairDeps {
  /** The official provider's two-step media fetch. */
  meta?: {
    getMediaUrl: typeof getMediaUrl;
    downloadMediaStream: typeof downloadMediaStream;
  };
  /** Plain GET of a public provider url, with a byte cap. */
  downloadPublic?: typeof downloadWhatsmiauMedia;
  /** The account's storage — defaults to its configured backend. */
  storage?: MediaStorage;
}

export interface RepairArgs {
  db: SupabaseClient;
  accountId: string;
  messageId: string;
  env?: Record<string, string | undefined>;
  deps?: RepairDeps;
}

/**
 * The urls our own storage serves.
 *
 * A url that starts with one of these is already durable — the repair
 * does nothing and returns it as it is.
 */
export function ownMediaPrefixes(
  env: Record<string, string | undefined> = process.env,
  publicBaseUrl: string | null = null,
): string[] {
  const prefixes: string[] = [];

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    prefixes.push(
      `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/`,
    );
  }

  const base = publicBaseUrl ?? env.MEDIA_PUBLIC_BASE_URL;
  if (base) {
    prefixes.push(`${base.replace(/\/$/, "")}/`);
  }

  return prefixes;
}

/** True when the url points at our own bucket. */
export function isOwnMediaUrl(url: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => url.startsWith(prefix));
}

/** The media id inside `/api/whatsapp/media/<mediaId>`. */
export function mediaIdFromProxyUrl(url: string): string | null {
  if (!url.startsWith(PROXY_PREFIX)) return null;
  const id = url.slice(PROXY_PREFIX.length).split("/")[0] ?? "";
  return id || null;
}

/** The downloader reported that the attachment is over the ceiling. */
function isTooLarge(error: unknown): boolean {
  return error instanceof Error && error.message.includes("exceeds");
}

/**
 * Restore one attachment.
 *
 * @returns the durable url — with `repaired: false` when the message
 *          already pointed at our own bucket.
 */
export async function repairMessageMedia(
  args: RepairArgs,
): Promise<RepairOutcome> {
  const { db, accountId, messageId } = args;
  const env = args.env ?? process.env;
  const deps = args.deps ?? {};

  const { data: message } = await db
    .from("messages")
    .select(
      "id, conversation_id, media_url, media_type, message_id, created_at",
    )
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, reason: "not-found" };

  // `messages` carries no account_id — the conversation does. A message
  // of another account is a 404, never a hint that it exists.
  const { data: conversation } = await db
    .from("conversations")
    .select("account_id")
    .eq("id", message.conversation_id)
    .maybeSingle();
  if (!conversation || conversation.account_id !== accountId) {
    return { ok: false, reason: "not-found" };
  }

  const mediaUrl =
    typeof message.media_url === "string" ? message.media_url.trim() : "";
  if (!mediaUrl) return { ok: false, reason: "no-media" };

  const settings = await readMediaSettings(db, accountId);
  const storage = deps.storage ?? mediaStorageFor(settings, db, env);

  // Already ours: nothing to do, and the call is idempotent.
  if (isOwnMediaUrl(mediaUrl, ownMediaPrefixes(env, settings.publicBaseUrl))) {
    return { ok: true, url: mediaUrl, repaired: false };
  }

  const maxBytes = Math.min(settings.maxFileBytes, CHAT_MEDIA_MAX_BYTES);
  const mime = normalizeMimeType(message.media_type as string | null);
  const proxyId = mediaIdFromProxyUrl(mediaUrl);

  let body: ReadableStream<Uint8Array>;
  let sourceMime: string | null = mime;
  // How many bytes the body holds — the bucket needs to know, or the
  // upload goes out as `Transfer-Encoding: chunked` and R2 refuses it.
  let contentLength: number | undefined;

  if (proxyId) {
    // The official provider: resolve the download url with the
    // account's token, then fetch the bytes with it.
    const { data: config } = await db
      .from("whatsapp_config")
      .select("access_token")
      .eq("account_id", accountId)
      .maybeSingle();
    if (!config) return { ok: false, reason: "no-config" };

    const getUrl = deps.meta?.getMediaUrl ?? getMediaUrl;
    const download = deps.meta?.downloadMediaStream ?? downloadMediaStream;
    const accessToken = decrypt(config.access_token);

    let info: Awaited<ReturnType<typeof getMediaUrl>>;
    try {
      info = await getUrl({ mediaId: proxyId, accessToken });
    } catch {
      // The provider answered with an error — most of the time it no
      // longer holds the bytes.
      return { ok: false, reason: "provider-missing" };
    }

    if (info.fileSize !== null && info.fileSize > maxBytes) {
      return { ok: false, reason: "too-large" };
    }

    try {
      const downloaded = await download({
        downloadUrl: info.url,
        accessToken,
        maxBytes,
      });
      body = downloaded.stream;
      contentLength =
        downloaded.contentLength ??
        (typeof info.fileSize === "number" ? info.fileSize : undefined);
      sourceMime =
        mime ??
        normalizeMimeType(info.mimeType) ??
        normalizeMimeType(downloaded.contentType);
    } catch (error) {
      return {
        ok: false,
        reason: isTooLarge(error) ? "too-large" : "provider-missing",
      };
    }
  } else if (/^https?:\/\//i.test(mediaUrl)) {
    // The unofficial provider hands us a public url: a plain GET.
    const download = deps.downloadPublic ?? downloadWhatsmiauMedia;
    try {
      const downloaded = await download(mediaUrl, maxBytes);
      body = downloaded.stream;
      contentLength = downloaded.contentLength ?? undefined;
      sourceMime = mime ?? normalizeMimeType(downloaded.contentType);
    } catch (error) {
      return {
        ok: false,
        reason: isTooLarge(error) ? "too-large" : "provider-missing",
      };
    }
  } else {
    // A url shape we don't know how to fetch.
    return { ok: false, reason: "failed" };
  }

  const uploadType = normalizeContentType(sourceMime);
  const objectName = mirrorFileName({
    mimeType: sourceMime,
    fileName: null,
    messageTimestamp: message.created_at as string | null,
  });
  const path = mirrorObjectPath(
    accountId,
    proxyId ?? (message.message_id as string | null) ?? (message.id as string),
    objectName,
  );

  try {
    const { publicUrl } = await storage.put({
      path,
      body,
      contentType: uploadType,
      contentLength,
      upsert: true,
    });

    const { error } = await db
      .from("messages")
      .update({ media_url: publicUrl })
      .eq("id", messageId);
    if (error) return { ok: false, reason: "failed" };

    return { ok: true, url: publicUrl, repaired: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
