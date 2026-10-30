import { createClient } from "@/lib/supabase/client";
import { getT } from "@/lib/i18n/translate";
import { normalizeContentType } from "@/lib/media/content-type";

const t = getT("LibErrors");

/**
 * Shared media-upload helper — the browser's side of the upload.
 *
 * The PATH is not the browser's decision: `/api/media/upload-url`
 * builds it, with the account's own backend (Supabase bucket or R2),
 * the account's own root folder and the taxonomy of
 * `@/lib/media/layout` — avatar, midias, documentos. A caller only
 * asks WHERE to send the bytes and how big they are.
 *
 * The file keeps the name the user gave it: the last segment of the url
 * IS the file's name, which is what the provider shows the recipient.
 */

/** 16 MB — the `flow-media` bucket's `file_size_limit` (migration 016). */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * 100 MB — the `chat-media` bucket's `file_size_limit` (migration 066),
 * and the same ceiling the provider applies to documents.
 */
export const CHAT_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Per-kind upload ceilings that mirror Meta's WhatsApp Cloud API caps so
 * a file that the bucket would accept but Meta would reject is caught
 * client-side BEFORE upload — otherwise it lands in storage as an
 * orphan and the send fails with a confusing 400. Images are Meta's
 * tightest cap at 5 MB; documents get Meta's full 100 MB, which the
 * `chat-media` bucket now allows too.
 */
export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
} as const;

export interface UploadAccountMediaResult {
  /** Public URL Meta can fetch at send time. */
  publicUrl: string;
  /** Storage object path (account-scoped). */
  path: string;
}

/** What `/api/media/upload-url` answers with. */
interface UploadTargetResponse {
  mode: "supabase" | "presigned";
  path: string;
  bucket?: string;
  url?: string;
  headers?: Record<string, string>;
  publicUrl: string;
}

/**
 * Ask the server where this file should go.
 *
 * The server owns the choice of backend (Supabase or R2) and builds
 * the account-scoped path — the browser never gets to name a bucket
 * or a path of its own.
 */
async function requestUploadTarget(
  bucket: string,
  file: File,
): Promise<UploadTargetResponse> {
  const response = await fetch("/api/media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      bucket,
    }),
  });

  if (response.status === 401) {
    throw new Error(t("upload.notSignedIn"));
  }

  const payload = (await response.json().catch(() => null)) as
    | (UploadTargetResponse & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || t("upload.failed"));
  }
  return payload;
}

/**
 * Upload a file to an account-scoped Storage bucket and return its public
 * URL. Throws with a user-facing message on auth / account-resolution /
 * upload failure — callers surface it via a toast.
 *
 * Size validation is the caller's responsibility (limits can differ per
 * feature); `MEDIA_MAX_BYTES` is exported for the common case.
 */
export async function uploadAccountMedia(
  bucket: string,
  file: File,
): Promise<UploadAccountMediaResult> {
  const target = await requestUploadTarget(bucket, file);
  const contentType = normalizeContentType(file.type);

  // Pre-signed backend: the bytes go straight to the object store and
  // never pass through the Next server.
  if (target.mode === "presigned" && target.url) {
    const response = await fetch(target.url, {
      method: "PUT",
      headers: target.headers ?? { "Content-Type": contentType },
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
    return { publicUrl: target.publicUrl, path: target.path };
  }

  const supabase = createClient();
  const { error: upErr } = await supabase.storage
    .from(target.bucket ?? bucket)
    .upload(target.path, file, {
      cacheControl: "3600",
      upsert: false,
      // The bucket carries an allow-list and refuses anything outside
      // it, so the type we declare has to be one it accepts. An
      // unknown format becomes `application/octet-stream` — the
      // browser downloads it instead of rendering it.
      contentType,
    });
  if (upErr) throw new Error(upErr.message);

  return { publicUrl: target.publicUrl, path: target.path };
}

/**
 * Delete a previously-uploaded object. Used to GC media that was staged
 * (uploaded) but never sent — a cancelled draft or a failed Meta send —
 * so abandoned attachments don't accumulate in the public bucket.
 *
 * The delete goes through the server: the R2 backend needs a signed
 * request, and the server is what guarantees the path belongs to the
 * caller's own account.
 *
 * Best-effort: callers fire-and-forget and swallow errors (a missed
 * delete is a storage nit, not something to surface to the user).
 */
export async function deleteAccountMedia(
  bucket: string,
  path: string,
): Promise<void> {
  const response = await fetch("/api/media/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, path }),
  });
  if (!response.ok) {
    throw new Error(`Delete failed with status ${response.status}`);
  }
}
