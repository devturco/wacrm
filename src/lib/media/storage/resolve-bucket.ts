import { DEFAULT_MEDIA_SETTINGS, type MediaSettings } from "./settings";

/**
 * The bucket a browser request means.
 *
 * The browser names the bucket it wants, and the names it uses are NOT
 * the account's: the composer and the template manager ask for
 * `chat-media` because that is where chat media has always lived, and
 * they cannot know what the account named its own bucket. So
 * `chat-media` means "the account's own media" and answers with the
 * account's configured bucket; any other name (the Flows builder's
 * `flow-media`) means that specific Supabase bucket, which has its own
 * RLS and stays on Supabase.
 *
 * Without this, an account that renamed its bucket would have the
 * composer writing to the default bucket while the mirror wrote to the
 * renamed one — the account's media split in two.
 */
export function resolveBucket(
  settings: MediaSettings,
  requested: string,
): string {
  const wanted = requested.trim();
  if (!wanted) return settings.bucket || DEFAULT_MEDIA_SETTINGS.bucket;
  if (wanted === DEFAULT_MEDIA_SETTINGS.bucket) {
    return settings.bucket || DEFAULT_MEDIA_SETTINGS.bucket;
  }
  return wanted;
}
