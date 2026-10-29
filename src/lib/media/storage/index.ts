import type { SupabaseClient } from "@supabase/supabase-js";
import { R2MediaStorage, r2ConfigFromEnv } from "./r2";
import { SupabaseMediaStorage } from "./supabase";
import { DEFAULT_MEDIA_SETTINGS, readMediaSettings } from "./settings";
import type { MediaSettings } from "./settings";
import type { MediaStorage } from "./types";

export type { MediaBackend, MediaStorage, UploadTarget } from "./types";
export { DEFAULT_MEDIA_SETTINGS, readMediaSettings } from "./settings";
export type { MediaSettings } from "./settings";
export { R2MediaStorage, r2ConfigFromEnv, r2Endpoint } from "./r2";
export { SupabaseMediaStorage } from "./supabase";

/**
 * The storage of an account.
 *
 * The choice comes from `media_settings`. With no configuration — or
 * with R2 selected but its credentials missing from the environment —
 * the account stays on Supabase, the backend that already works.
 *
 * `bucket` names the bucket the caller wants to write to. A bucket
 * other than the account's configured one (the Flows builder writes to
 * `flow-media`) always stays on Supabase: R2 has one bucket per
 * account, and the extra Supabase buckets have their own RLS.
 */
export async function getMediaStorage(
  accountId: string,
  db: Pick<SupabaseClient, "from">,
  bucket?: string,
): Promise<MediaStorage> {
  const settings = await readMediaSettings(db, accountId);
  return mediaStorageFor(settings, db, process.env, bucket);
}

/**
 * The storage for a configuration that was already read.
 *
 * `db` is only needed by the Supabase backend — R2 talks to Cloudflare
 * over plain HTTP with SigV4.
 */
export function mediaStorageFor(
  settings: MediaSettings,
  db: Pick<SupabaseClient, "from">,
  env: Record<string, string | undefined> = process.env,
  bucket?: string,
): MediaStorage {
  const targetBucket = bucket || settings.bucket || DEFAULT_MEDIA_SETTINGS.bucket;
  const configuredBucket = settings.bucket || DEFAULT_MEDIA_SETTINGS.bucket;

  if (settings.backend === "r2" && targetBucket === configuredBucket) {
    const config = r2ConfigFromEnv(env);
    if (config) {
      return new R2MediaStorage({
        accountId: config.accountId,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        bucket: targetBucket,
        publicBaseUrl: settings.publicBaseUrl ?? config.publicBaseUrl,
        maxFileBytes: settings.maxFileBytes,
      });
    }
  }

  return new SupabaseMediaStorage({
    bucket: targetBucket,
    publicBaseUrl: settings.publicBaseUrl,
    client: db as SupabaseClient,
    maxFileBytes: settings.maxFileBytes,
  });
}
