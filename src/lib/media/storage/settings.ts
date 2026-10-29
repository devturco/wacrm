import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaBackend } from "./types";

/** The storage configuration of an account. */
export interface MediaSettings {
  /** Which backend holds the media. */
  backend: MediaBackend;
  /** Bucket the objects live in. */
  bucket: string;
  /** Per-account ceiling, in bytes. */
  maxFileBytes: number;
  /** Public base URL, when the backend needs one. */
  publicBaseUrl: string | null;
}

/** What an account gets before it configures anything. */
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  backend: "supabase",
  bucket: "chat-media",
  maxFileBytes: 104857600,
  publicBaseUrl: null,
};

/**
 * Reads an account's storage configuration.
 *
 * A failed read is NOT an error: the account falls back to the default
 * (Supabase), which is what it used before this feature existed. A
 * broken configuration must never take the inbox down.
 */
export async function readMediaSettings(
  db: Pick<SupabaseClient, "from">,
  accountId: string,
): Promise<MediaSettings> {
  const { data, error } = await db
    .from("media_settings")
    .select("backend, bucket, max_file_bytes, public_base_url")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error || !data) return DEFAULT_MEDIA_SETTINGS;

  return {
    backend: (data.backend as MediaBackend) ?? DEFAULT_MEDIA_SETTINGS.backend,
    bucket: data.bucket ?? DEFAULT_MEDIA_SETTINGS.bucket,
    maxFileBytes:
      data.max_file_bytes ?? DEFAULT_MEDIA_SETTINGS.maxFileBytes,
    publicBaseUrl: data.public_base_url ?? null,
  };
}
