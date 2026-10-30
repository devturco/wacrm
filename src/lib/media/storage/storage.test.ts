import { describe, expect, it, vi } from "vitest";
import { mediaStorageFor } from "./index";
import { resolveBucket } from "./resolve-bucket";
import { R2MediaStorage, r2ConfigFromEnv } from "./r2";
import { SupabaseMediaStorage } from "./supabase";
import {
  DEFAULT_MEDIA_SETTINGS,
  mediaFieldVisibility,
  readMediaSettings,
} from "./settings";

/** A Supabase client stub good enough for the storage surface. */
function fakeSupabase(publicBase = "https://cdn.test/storage/v1/object/public") {
  const uploads: { path: string; options: unknown }[] = [];
  const removed: string[] = [];

  const bucketApi = {
    upload: vi.fn(async (path: string, _body: unknown, options: unknown) => {
      uploads.push({ path, options });
      return { error: null };
    }),
    getPublicUrl: vi.fn((path: string) => ({
      data: { publicUrl: `${publicBase}/chat-media/${path}` },
    })),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(...paths);
      return { error: null };
    }),
  };

  const client = {
    storage: { from: () => bucketApi },
  } as never;

  return { client, uploads, removed, bucketApi };
}

describe("SupabaseMediaStorage", () => {
  it("prepares a direct browser upload and the public url", async () => {
    const { client } = fakeSupabase();
    const storage = new SupabaseMediaStorage({
      bucket: "chat-media",
      publicBaseUrl: null,
      client,
    });

    const target = await storage.prepareUpload({
      accountId: "acc-1",
      fileName: "foto.jpg",
      contentType: "image/jpeg",
      sizeBytes: 10,
    });

    expect(target.mode).toBe("supabase");
    expect(target.bucket).toBe("chat-media");
    expect(target.path.startsWith("account-acc-1/")).toBe(true);
    expect(target.path.endsWith(".jpg")).toBe(true);
    expect(target.publicUrl).toContain(target.path);
  });

  it("writes the object with the declared type", async () => {
    const { client, uploads } = fakeSupabase();
    const storage = new SupabaseMediaStorage({
      bucket: "chat-media",
      publicBaseUrl: null,
      client,
    });

    const result = await storage.put({
      path: "account-acc-1/inbound/x.pdf",
      body: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      upsert: true,
    });

    expect(uploads[0]?.path).toBe("account-acc-1/inbound/x.pdf");
    expect(uploads[0]?.options).toMatchObject({
      contentType: "application/pdf",
      upsert: true,
    });
    expect(result.size).toBe(3);
  });

  it("removes an object", async () => {
    const { client, removed } = fakeSupabase();
    const storage = new SupabaseMediaStorage({
      bucket: "chat-media",
      publicBaseUrl: null,
      client,
    });

    await storage.remove("account-acc-1/x.png");
    expect(removed).toEqual(["account-acc-1/x.png"]);
  });

  it("prefers the configured public base url", () => {
    const { client } = fakeSupabase();
    const storage = new SupabaseMediaStorage({
      bucket: "chat-media",
      publicBaseUrl: "https://media.test/",
      client,
    });

    expect(storage.publicUrl("account-acc-1/x.png")).toBe(
      "https://media.test/account-acc-1/x.png",
    );
  });
});

describe("R2MediaStorage", () => {
  const config = {
    accountId: "r2-account",
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "secret",
    bucket: "crmbr-media",
    publicBaseUrl: "https://media.test",
  };

  it("presigns a PUT against the R2 endpoint", async () => {
    const storage = new R2MediaStorage(config);

    const target = await storage.prepareUpload({
      accountId: "acc-1",
      fileName: "contrato.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
    });

    expect(target.mode).toBe("presigned");
    expect(target.url).toContain(
      "https://r2-account.r2.cloudflarestorage.com/crmbr-media/",
    );
    expect(target.url).toContain("X-Amz-Signature=");
    expect(target.url).toContain("X-Amz-Expires=900");
    expect(target.headers?.["Content-Type"]).toBe("application/pdf");
    expect(target.publicUrl).toContain(
      "https://media.test/account-acc-1/",
    );
    expect(target.publicUrl.endsWith(".pdf")).toBe(true);
  });

  it("never lets the secret reach the caller", async () => {
    const storage = new R2MediaStorage(config);
    const target = await storage.prepareUpload({
      accountId: "acc-1",
      fileName: "a.pdf",
      contentType: "application/pdf",
      sizeBytes: 1,
    });

    // The access key ID is IN the signed URL — that is how SigV4
    // validates it, and it is an identifier, not a secret. The secret
    // access key is what must never leave the server.
    expect(target.url).not.toContain("secret");
    expect(target.url).not.toContain(config.secretAccessKey);
    expect(JSON.stringify(target)).not.toContain("secretAccessKey");
  });
});

describe("r2ConfigFromEnv", () => {
  it("reports the missing variable names, never their values", () => {
    const config = r2ConfigFromEnv({
      R2_ACCOUNT_ID: "r2-account",
      R2_ACCESS_KEY_ID: "AKIA_TEST",
      // no secret, no public base url
    });

    expect(config).toBeNull();
  });

  it("reads a complete configuration", () => {
    const config = r2ConfigFromEnv({
      R2_ACCOUNT_ID: "r2-account",
      R2_ACCESS_KEY_ID: "AKIA_TEST",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "crmbr-media",
      MEDIA_PUBLIC_BASE_URL: "https://media.test",
    });

    expect(config?.bucket).toBe("crmbr-media");
    expect(config?.publicBaseUrl).toBe("https://media.test");
    expect(config?.missing).toEqual([]);
  });
});

describe("readMediaSettings", () => {
  it("falls back to the default when the table is empty", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as never;

    await expect(readMediaSettings(db, "acc-1")).resolves.toEqual(
      DEFAULT_MEDIA_SETTINGS,
    );
  });

  it("reads the account's configuration", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                backend: "r2",
                bucket: "crmbr-media",
                max_file_bytes: 52428800,
                public_base_url: "https://media.test",
              },
              error: null,
            }),
          }),
        }),
      }),
    } as never;

    const settings = await readMediaSettings(db, "acc-1");
    expect(settings.backend).toBe("r2");
    expect(settings.bucket).toBe("crmbr-media");
    expect(settings.maxFileBytes).toBe(52428800);
    expect(settings.publicBaseUrl).toBe("https://media.test");
  });
});

describe("mediaStorageFor", () => {
  it("picks R2 when the account chose it and the credentials are there", () => {
    const { client } = fakeSupabase();
    const storage = mediaStorageFor(
      {
        backend: "r2",
        bucket: "crmbr-media",
        maxFileBytes: 104857600,
        publicBaseUrl: "https://media.test",
      },
      client,
      {
        R2_ACCOUNT_ID: "r2-account",
        R2_ACCESS_KEY_ID: "AKIA_TEST",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "crmbr-media",
        MEDIA_PUBLIC_BASE_URL: "https://media.test",
      },
    );

    expect(storage.backend).toBe("r2");
    expect(storage.bucket).toBe("crmbr-media");
  });

  it("stays on Supabase when the R2 credentials are missing", () => {
    const { client } = fakeSupabase();
    const storage = mediaStorageFor(
      {
        backend: "r2",
        bucket: "crmbr-media",
        maxFileBytes: 104857600,
        publicBaseUrl: null,
      },
      client,
      {},
    );

    expect(storage.backend).toBe("supabase");
  });
});

describe("mediaStorageFor — whose bucket is it", () => {
  const R2_ENV = {
    R2_ACCOUNT_ID: "r2-account",
    R2_ACCESS_KEY_ID: "AKIA_TEST",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "crmbr-bucket",
    MEDIA_PUBLIC_BASE_URL: "https://media.test",
  };

  it("writes to the bucket the SERVER names, not the account's", () => {
    const { client } = fakeSupabase();
    const storage = mediaStorageFor(
      {
        backend: "r2",
        // The account's column is the SUPABASE bucket — it has no say
        // over where R2 writes.
        bucket: "chat-media",
        maxFileBytes: 104857600,
        publicBaseUrl: null,
      },
      client,
      R2_ENV,
    );

    expect(storage.backend).toBe("r2");
    expect(storage.bucket).toBe("crmbr-bucket");
  });

  it("keeps a bucket other than the account's own on Supabase", () => {
    const { client } = fakeSupabase();
    const storage = mediaStorageFor(
      {
        backend: "r2",
        bucket: "chat-media",
        maxFileBytes: 104857600,
        publicBaseUrl: null,
      },
      client,
      R2_ENV,
      "flow-media",
    );

    expect(storage.backend).toBe("supabase");
    expect(storage.bucket).toBe("flow-media");
  });
});

describe("resolveBucket", () => {
  const settings = {
    backend: "r2" as const,
    bucket: "atacados",
    maxFileBytes: 104857600,
    publicBaseUrl: null,
  };

  it("answers the account's own bucket for the default chat bucket", () => {
    // The browser says "chat-media" because that is where chat media
    // has always lived — it cannot know what the account named its
    // bucket.
    expect(resolveBucket(settings, "chat-media")).toBe("atacados");
  });

  it("leaves another bucket alone", () => {
    // The Flows builder writes to `flow-media`, which has its own RLS.
    expect(resolveBucket(settings, "flow-media")).toBe("flow-media");
  });

  it("falls back to the default when the account named none", () => {
    expect(
      resolveBucket({ ...settings, bucket: "" }, "chat-media"),
    ).toBe("chat-media");
  });
});

describe("mediaFieldVisibility", () => {
  it("shows both fields on Supabase", () => {
    expect(
      mediaFieldVisibility("supabase", { publicBaseUrl: null, r2Missing: [] }),
    ).toEqual({ bucket: true, publicBaseUrl: true, serverOwned: [] });
  });

  it("hides the R2 bucket — the server names it", () => {
    const visibility = mediaFieldVisibility("r2", {
      publicBaseUrl: null,
      r2Missing: [],
    });

    expect(visibility.bucket).toBe(false);
    expect(visibility.serverOwned).toContain("R2_BUCKET");
  });

  it("hides the public URL when the server provides it", () => {
    const visibility = mediaFieldVisibility("r2", {
      publicBaseUrl: null,
      r2Missing: [],
    });

    expect(visibility.publicBaseUrl).toBe(false);
    expect(visibility.serverOwned).toContain("MEDIA_PUBLIC_BASE_URL");
  });

  it("shows the public URL when the server does not have one", () => {
    // The account has to paste it — that is how an account runs R2
    // without touching the environment.
    const visibility = mediaFieldVisibility("r2", {
      publicBaseUrl: null,
      r2Missing: ["MEDIA_PUBLIC_BASE_URL"],
    });

    expect(visibility.publicBaseUrl).toBe(true);
  });

  it("shows the public URL when the account has its own", () => {
    const visibility = mediaFieldVisibility("r2", {
      publicBaseUrl: "https://cdn.acme.com",
      r2Missing: [],
    });

    expect(visibility.publicBaseUrl).toBe(true);
  });
});
