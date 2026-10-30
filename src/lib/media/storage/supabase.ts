import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMediaPath, CHAT_MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";
import type { MediaStorage, UploadTarget } from "./types";

export interface SupabaseMediaStorageOptions {
  /** Bucket the objects live in (`chat-media` by default). */
  bucket: string;
  /** Public base URL; when null, the bucket's own URL is used. */
  publicBaseUrl: string | null;
  /** The client the objects are written with. */
  client: SupabaseClient;
  /** The account's ceiling, in bytes. */
  maxFileBytes?: number;
}

/**
 * Media in Supabase Storage — the default backend.
 *
 * The `chat-media` bucket is PUBLIC (migration 023) because the
 * provider fetches the media without authentication at send time. The
 * browser uploads through the client SDK and the bucket's RLS matches
 * the FIRST path segment (`account-<uuid>`), so the path must come
 * from `buildMediaPath`.
 */
export class SupabaseMediaStorage implements MediaStorage {
  readonly backend = "supabase" as const;
  readonly bucket: string;
  readonly maxFileBytes: number;

  private readonly options: SupabaseMediaStorageOptions;

  constructor(options: SupabaseMediaStorageOptions) {
    this.options = options;
    this.bucket = options.bucket;
    this.maxFileBytes = options.maxFileBytes ?? CHAT_MEDIA_MAX_BYTES;
  }

  async prepareUpload(args: {
    accountId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<UploadTarget> {
    const path = buildMediaPath(args.accountId, args.fileName);
    return {
      mode: "supabase",
      bucket: this.options.bucket,
      path,
      publicUrl: this.publicUrl(path),
    };
  }

  async put(args: {
    path: string;
    body: ReadableStream<Uint8Array> | Uint8Array | Buffer;
    contentType: string;
    /** Ignored here — the SDK reads the length off the body itself. */
    contentLength?: number;
    upsert?: boolean;
    cacheControl?: string;
  }): Promise<{ publicUrl: string; path: string; size: number }> {
    const { error } = await this.options.client.storage
      .from(this.options.bucket)
      .upload(args.path, args.body, {
        contentType: args.contentType,
        cacheControl: args.cacheControl ?? "3600",
        upsert: args.upsert ?? false,
      });
    if (error) throw new Error(error.message);
    return {
      publicUrl: this.publicUrl(args.path),
      path: args.path,
      size: byteLengthOf(args.body),
    };
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.options.client.storage
      .from(this.options.bucket)
      .remove([path]);
    if (error) throw new Error(error.message);
  }

  publicUrl(path: string): string {
    if (this.options.publicBaseUrl) {
      return `${this.options.publicBaseUrl.replace(/\/$/, "")}/${path}`;
    }
    const {
      data: { publicUrl },
    } = this.options.client.storage.from(this.options.bucket).getPublicUrl(path);
    return publicUrl;
  }
}

/** How many bytes the body holds, when it can be told without reading it. */
function byteLengthOf(
  body: ReadableStream<Uint8Array> | Uint8Array | Buffer,
): number {
  if (body instanceof Uint8Array) return body.byteLength;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
    return body.byteLength;
  }
  return 0;
}
