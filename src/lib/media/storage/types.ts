import type { MediaFolder } from "../layout";

/** Which backend holds the media for an account. */
export type MediaBackend = "supabase" | "r2";

/**
 * The account a storage belongs to.
 *
 * The id is what scopes every path. The name is what the R2 folder is
 * called — R2 has no RLS, so the folder is the only boundary between
 * two tenants there.
 */
export interface MediaAccount {
  /** The CRM account (the tenant). */
  id: string;
  /** The account's company name. */
  name?: string | null;
}

/** Where the bytes go. */
export interface UploadTarget {
  /**
   * `supabase` — the client SDK uploads the file straight to the bucket.
   * `presigned` — the browser does a PUT against a signed URL.
   */
  mode: "supabase" | "presigned";
  /** Object path (inside the account's folder). */
  path: string;
  /** Bucket — `supabase` mode only. */
  bucket?: string;
  /** Signed URL — `presigned` mode only. */
  url?: string;
  /** Headers the PUT must carry — `presigned` mode only. */
  headers?: Record<string, string>;
  /** Final public URL of the object. */
  publicUrl: string;
}

/** The media storage surface, whichever backend the account picked. */
export interface MediaStorage {
  readonly backend: MediaBackend;
  /** Bucket the objects live in. */
  readonly bucket: string;
  /** The account's ceiling, in bytes. */
  readonly maxFileBytes: number;
  /**
   * The first segment of every path this storage writes — the
   * account's own folder.
   *
   * `account-<uuid>` on Supabase (the bucket's RLS matches that exact
   * segment) and the company's slug on R2.
   */
  readonly root: string;
  /**
   * The path of a file inside the account's tree.
   *
   * The folder (`avatar`, `midias`, `documentos`) and the file name
   * are the caller's decision; the root is the storage's.
   */
  pathFor(args: {
    folder: MediaFolder;
    fileName: string;
    contentType?: string | null;
    /** The uniqueness folder — a stamp, an inbound segment. */
    segment?: string | null;
  }): string;
  /**
   * Where the browser should send the bytes.
   *
   * The credentials NEVER reach the browser: in `presigned` mode what
   * leaves the server is a URL that is already signed.
   */
  prepareUpload(args: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<UploadTarget>;
  /** Write the bytes. Server-side only. */
  put(args: {
    path: string;
    body: ReadableStream<Uint8Array> | Uint8Array | Buffer;
    contentType: string;
    /**
     * How many bytes the body holds, when it is known.
     *
     * It is NOT optional in practice: R2's S3 API refuses a PUT whose
     * length is unknown (a stream goes out as `Transfer-Encoding:
     * chunked`, and the bucket answers "length required"). The
     * caller knows the size — from the provider's metadata or from the
     * download's own header — and passing it is what makes the
     * streaming upload work.
     */
    contentLength?: number;
    upsert?: boolean;
    cacheControl?: string;
  }): Promise<{ publicUrl: string; path: string; size: number }>;
  /** Remove an object. Best-effort on the caller's side. */
  remove(path: string): Promise<void>;
  /** The public URL of an object already in the bucket. */
  publicUrl(path: string): string;
}
