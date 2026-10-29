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
 * The ceilings the settings screen offers, in bytes.
 *
 * 100 MB is the WhatsApp document limit and the bucket's own limit —
 * anything above it would be refused downstream anyway.
 */
export const MEDIA_SIZE_OPTIONS = [
  26214400, // 25 MB
  52428800, // 50 MB
  104857600, // 100 MB
] as const;

/** Is this a ceiling the app accepts? */
export function isAllowedMediaSize(size: number): boolean {
  return (MEDIA_SIZE_OPTIONS as readonly number[]).includes(size);
}

/** Which fields the settings screen shows, and what the server owns. */
export interface MediaFieldVisibility {
  /** Is the account's own bucket shown? */
  bucket: boolean;
  /** Is the account's own public base URL shown? */
  publicBaseUrl: boolean;
  /** The server variables that own whatever is not shown. */
  serverOwned: string[];
}

/**
 * Which settings belong to the account, and which to the server.
 *
 * The two backends do NOT share the same settings. `bucket` and
 * `public_base_url` are the account's SUPABASE configuration; the R2
 * bucket and the R2 public URL belong to the server's environment
 * (`R2_BUCKET`, `MEDIA_PUBLIC_BASE_URL`). The screen does not pretend
 * otherwise — an input the customer fills in that the server ignores is
 * a lie.
 *
 * The public base URL is the one exception: an account owns it when it
 * has one saved, or when the server does not provide one — that is how
 * an account runs R2 without touching the environment.
 */
export function mediaFieldVisibility(
  backend: MediaBackend,
  options: { publicBaseUrl: string | null; r2Missing: string[] },
): MediaFieldVisibility {
  if (backend !== "r2") {
    return { bucket: true, publicBaseUrl: true, serverOwned: [] };
  }

  // The R2 bucket is the server's — `R2_BUCKET`. The account's `bucket`
  // column names the Supabase bucket.
  const serverOwned = ["R2_BUCKET"];

  // The public base URL belongs to the account when it has one saved, or
  // when the server does not provide one — then the account has to paste
  // it. Only when the server provides it AND the account has none is it
  // the server's business alone.
  const own = Boolean(options.publicBaseUrl);
  const serverHas =
    !options.r2Missing.includes("MEDIA_PUBLIC_BASE_URL") && !own;
  const publicBaseUrl = !serverHas;
  if (!publicBaseUrl) serverOwned.push("MEDIA_PUBLIC_BASE_URL");

  return { bucket: false, publicBaseUrl, serverOwned };
}

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
