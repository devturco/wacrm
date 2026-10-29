import { AwsClient, AwsV4Signer } from "aws4fetch";
import { buildMediaPath, CHAT_MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";
import type { MediaStorage, UploadTarget } from "./types";

export interface R2Config {
  /** Cloudflare account id — the first half of the endpoint. */
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Bucket the objects live in. */
  bucket: string;
  /** Public base URL in front of the bucket, e.g. `https://media.crmbr.com`. */
  publicBaseUrl: string;
}

/** How long a pre-signed upload URL stays valid. */
export const PRESIGN_EXPIRES_SECONDS = 900;

/**
 * The environment variables R2 needs — and whether they are there.
 *
 * Only the NAMES travel to the browser: the settings screen says which
 * variables to set, never what they hold.
 *
 * `overrides.publicBaseUrl` is the account's own base URL, configured
 * in the settings screen — when it is there, the env variable is not
 * needed at all.
 */
export function r2MissingFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: { publicBaseUrl?: string | null } = {},
): string[] {
  const missing: string[] = [];
  if (!env.R2_ACCOUNT_ID) missing.push("R2_ACCOUNT_ID");
  if (!env.R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (!overrides.publicBaseUrl && !env.MEDIA_PUBLIC_BASE_URL) {
    missing.push("MEDIA_PUBLIC_BASE_URL");
  }
  return missing;
}

/**
 * Reads the R2 configuration from the environment.
 *
 * The credentials are SERVER-ONLY: they never reach the browser. What
 * reaches the browser is a URL that is already signed.
 *
 * @returns the config plus the names of the variables that are missing —
 *          the names, never the values — so the settings screen can say
 *          what to set without leaking a secret.
 */
export function r2ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: { publicBaseUrl?: string | null } = {},
): (R2Config & { missing: string[] }) | null {
  const missing = r2MissingFromEnv(env, overrides);
  if (missing.length > 0) return null;

  return {
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET ?? "wacrm-media",
    publicBaseUrl: overrides.publicBaseUrl ?? env.MEDIA_PUBLIC_BASE_URL!,
    missing,
  };
}

/** The S3-compatible endpoint of an object. */
export function r2Endpoint(config: R2Config, key: string): string {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
}

/**
 * Media in Cloudflare R2 — the S3-compatible option.
 *
 * The bucket has to be PUBLIC behind a custom domain
 * (`media.crmbr.com`), because the provider fetches the media without
 * authentication at send time — the same premise as today's public
 * `chat-media` bucket.
 *
 * The account separation is unchanged: it lives in the object's first
 * path segment (`account-<uuid>/…`), exactly as in Supabase Storage.
 */
export class R2MediaStorage implements MediaStorage {
  readonly backend = "r2" as const;
  readonly bucket: string;
  readonly maxFileBytes: number;

  private readonly config: R2Config;

  constructor(config: R2Config & { maxFileBytes?: number }) {
    this.config = config;
    this.bucket = config.bucket;
    this.maxFileBytes = config.maxFileBytes ?? CHAT_MEDIA_MAX_BYTES;
  }

  private endpoint(key: string): string {
    return r2Endpoint(this.config, key);
  }

  async prepareUpload(args: {
    accountId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<UploadTarget> {
    const path = buildMediaPath(args.accountId, args.fileName);
    const url = await this.presign(path, args.contentType);
    return {
      mode: "presigned",
      path,
      url,
      headers: { "Content-Type": args.contentType },
      publicUrl: this.publicUrl(path),
    };
  }

  /**
   * A pre-signed PUT URL, valid for {@link PRESIGN_EXPIRES_SECONDS}.
   *
   * The signature covers the host only — `content-type` is one of the
   * headers AWS excludes from the canonical request — so the browser
   * can send the type we chose without having to reproduce a byte
   * order.
   *
   * The access key ID is IN the URL: that is how SigV4 identifies the
   * signer, and it is an identifier, not a secret. The secret access
   * key never leaves the server.
   */
  private async presign(path: string, contentType: string): Promise<string> {
    const url = new URL(this.endpoint(path));
    // Set before signing: the signer only fills this in when absent.
    url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRES_SECONDS));

    const signer = new AwsV4Signer({
      method: "PUT",
      url: url.toString(),
      headers: { "Content-Type": contentType },
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: "auto",
      service: "s3",
      signQuery: true,
    });

    const signed = await signer.sign();
    return signed.url.toString();
  }

  private client(): AwsClient {
    return new AwsClient({
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: "auto",
      service: "s3",
    });
  }

  async put(args: {
    path: string;
    body: ReadableStream<Uint8Array> | Uint8Array | Buffer;
    contentType: string;
    upsert?: boolean;
    cacheControl?: string;
  }): Promise<{ publicUrl: string; path: string; size: number }> {
    const headers: Record<string, string> = {
      "Content-Type": args.contentType,
    };
    if (args.cacheControl) headers["Cache-Control"] = args.cacheControl;

    const response = await this.client().fetch(this.endpoint(args.path), {
      method: "PUT",
      body: args.body as BodyInit,
      headers,
    });
    if (!response.ok) {
      throw new Error(`R2 upload failed with status ${response.status}`);
    }
    return {
      publicUrl: this.publicUrl(args.path),
      path: args.path,
      size: byteLengthOf(args.body),
    };
  }

  async remove(path: string): Promise<void> {
    const response = await this.client().fetch(this.endpoint(path), {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`R2 delete failed with status ${response.status}`);
    }
  }

  publicUrl(path: string): string {
    return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${path}`;
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
