import type { MediaStorage, UploadTarget } from "./types";

/** One recorded write. */
export interface FakePut {
  path: string;
  body: ReadableStream<Uint8Array> | Uint8Array | Buffer;
  /** How many bytes the body held, when it can be told without reading it. */
  bytes: number;
  contentType: string;
  upsert?: boolean;
  cacheControl?: string;
}

export interface FakeMediaStorage {
  storage: MediaStorage;
  /** Every write, in order. */
  puts: FakePut[];
  /** Every removal, in order. */
  removals: string[];
}

export interface FakeMediaStorageOptions {
  /** Which backend the account chose. */
  backend?: "supabase" | "r2";
  /** The bucket the backend writes to. */
  bucket?: string;
  /** The account's ceiling, in bytes. */
  maxFileBytes?: number;
  /** The public base the objects are served from. */
  publicBase?: string;
  /** When set, every write fails with this message. */
  failWith?: string;
}

/**
 * A `MediaStorage` that records what was written to it.
 *
 * The mirror used to talk to Supabase Storage directly, so its tests
 * faked a bucket API. It now talks to the ACCOUNT's backend — Supabase
 * bucket or R2 — so the fake has to be the whole interface: a test
 * asserts on the backend, the bucket and the public URL to prove the
 * bytes went where the account asked.
 */
export function fakeMediaStorage(
  options: FakeMediaStorageOptions = {},
): FakeMediaStorage {
  const backend = options.backend ?? "supabase";
  const bucket = options.bucket ?? "chat-media";
  const maxFileBytes = options.maxFileBytes ?? 104857600;
  const publicBase = options.publicBase ?? `https://cdn.test/storage/${bucket}`;

  const puts: FakePut[] = [];
  const removals: string[] = [];

  const storage: MediaStorage = {
    backend,
    bucket,
    maxFileBytes,

    async prepareUpload(args): Promise<UploadTarget> {
      const path = `account-${args.accountId}/${args.fileName}`;
      return {
        mode: backend === "r2" ? "presigned" : "supabase",
        path,
        publicUrl: `${publicBase}/${path}`,
      };
    },

    async put(args) {
      puts.push({
        path: args.path,
        body: args.body,
        bytes: byteLengthOf(args.body),
        contentType: args.contentType,
        upsert: args.upsert,
        cacheControl: args.cacheControl,
      });
      if (options.failWith) throw new Error(options.failWith);
      return {
        publicUrl: `${publicBase}/${args.path}`,
        path: args.path,
        size: 0,
      };
    },

    async remove(path) {
      removals.push(path);
    },

    publicUrl(path) {
      return `${publicBase}/${path}`;
    },
  };

  return { storage, puts, removals };
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
