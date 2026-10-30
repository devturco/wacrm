import type { SupabaseClient } from "@supabase/supabase-js";
import { R2MediaStorage, r2ConfigFromEnv } from "./r2";
import { SupabaseMediaStorage } from "./supabase";
import { DEFAULT_MEDIA_SETTINGS, readMediaSettings } from "./settings";
import type { MediaSettings } from "./settings";
import type { MediaAccount, MediaBackend, MediaStorage } from "./types";

export type { MediaAccount, MediaBackend, MediaStorage, UploadTarget } from "./types";
export {
  DEFAULT_MEDIA_SETTINGS,
  MEDIA_SIZE_OPTIONS,
  isAllowedMediaSize,
  mediaFieldVisibility,
  readMediaSettings,
} from "./settings";
export { resolveBucket } from "./resolve-bucket";
export type { MediaFieldVisibility, MediaSettings } from "./settings";
export { R2MediaStorage, r2ConfigFromEnv, r2Endpoint, r2MissingFromEnv } from "./r2";
export { SupabaseMediaStorage } from "./supabase";

/**
 * The account a storage belongs to — its id and, on R2, the name its
 * folder is named after.
 *
 * The name is only read when the backend needs it: Supabase's root is
 * the account id itself, so a Supabase account never pays for the
 * extra query.
 */
export async function readMediaAccount(
  db: Pick<SupabaseClient, "from">,
  accountId: string,
  backend: MediaBackend = "supabase",
): Promise<MediaAccount> {
  if (backend !== "r2") return { id: accountId, name: null };

  const { data } = await db
    .from("accounts")
    .select("name")
    .eq("id", accountId)
    .maybeSingle();

  return { id: accountId, name: (data?.name as string | null) ?? null };
}

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
 *
 * A BROWSER request names `chat-media` for "the account's own media" —
 * run it through {@link resolveBucket} first, or an account that
 * renamed its bucket sends its uploads to the wrong place.
 */
export async function getMediaStorage(
  accountId: string,
  db: Pick<SupabaseClient, "from">,
  bucket?: string,
): Promise<MediaStorage> {
  const settings = await readMediaSettings(db, accountId);
  const account = await readMediaAccount(db, accountId, settings.backend);
  return mediaStorageFor(settings, db, process.env, bucket, account);
}

/**
 * The account's storage, never throwing.
 *
 * The webhooks are the callers that cannot afford an exception: a
 * throw there loses the whole message, and a lost message is worse than
 * an attachment that was not mirrored. A broken settings read falls
 * back to the Supabase bucket — the backend every attachment lived in
 * before the setting existed, and one whose objects stay readable.
 */
export async function safeMediaStorage(
  accountId: string,
  db: Pick<SupabaseClient, "from">,
  bucket?: string,
): Promise<MediaStorage> {
  try {
    return await getMediaStorage(accountId, db, bucket);
  } catch (error) {
    console.warn(
      "[media/storage] could not read the account's storage settings; using the default backend:",
      error instanceof Error ? error.message : error,
    );
    return mediaStorageFor(
      DEFAULT_MEDIA_SETTINGS,
      db,
      process.env,
      bucket,
      { id: accountId, name: null },
    );
  }
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
  account: MediaAccount = { id: "", name: null },
): MediaStorage {
  const configuredBucket = settings.bucket || DEFAULT_MEDIA_SETTINGS.bucket;
  // The caller named a bucket other than the account's own: it wants a
  // DIFFERENT Supabase bucket — the Flows builder writes to
  // `flow-media`, which has its own RLS. R2 has one bucket per
  // deployment, so that request stays on Supabase.
  const wantsOwnBucket = !bucket || bucket === configuredBucket;

  if (settings.backend === "r2" && wantsOwnBucket) {
    const config = r2ConfigFromEnv(env, {
      publicBaseUrl: settings.publicBaseUrl,
    });
    if (config) {
      return new R2MediaStorage({
        accountId: config.accountId,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        // The R2 bucket belongs to the SERVER — `R2_BUCKET`. The
        // account's `bucket` column names the SUPABASE bucket and has
        // no say here.
        bucket: config.bucket,
        publicBaseUrl: config.publicBaseUrl,
        maxFileBytes: settings.maxFileBytes,
        // The folder the account's files live in — the company's name.
        account,
      });
    }
  }

  return new SupabaseMediaStorage({
    bucket: bucket || configuredBucket,
    publicBaseUrl: settings.publicBaseUrl,
    client: db as SupabaseClient,
    maxFileBytes: settings.maxFileBytes,
    account,
  });
}
