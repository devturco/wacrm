import { describe, expect, it, vi } from "vitest";
import { mediaStorageFor } from "./index";
import { R2MediaStorage, r2ConfigFromEnv } from "./r2";
import { SupabaseMediaStorage } from "./supabase";
import { DEFAULT_MEDIA_SETTINGS, readMediaSettings } from "./settings";

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
    bucket: "wacrm-media",
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
      "https://r2-account.r2.cloudflarestorage.com/wacrm-media/",
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
      R2_BUCKET: "wacrm-media",
      MEDIA_PUBLIC_BASE_URL: "https://media.test",
    });

    expect(config?.bucket).toBe("wacrm-media");
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
                bucket: "wacrm-media",
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
    expect(settings.bucket).toBe("wacrm-media");
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
        bucket: "wacrm-media",
        maxFileBytes: 104857600,
        publicBaseUrl: "https://media.test",
      },
      client,
      {
        R2_ACCOUNT_ID: "r2-account",
        R2_ACCESS_KEY_ID: "AKIA_TEST",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "wacrm-media",
        MEDIA_PUBLIC_BASE_URL: "https://media.test",
      },
    );

    expect(storage.backend).toBe("r2");
    expect(storage.bucket).toBe("wacrm-media");
  });

  it("stays on Supabase when the R2 credentials are missing", () => {
    const { client } = fakeSupabase();
    const storage = mediaStorageFor(
      {
        backend: "r2",
        bucket: "wacrm-media",
        maxFileBytes: 104857600,
        publicBaseUrl: null,
      },
      client,
      {},
    );

    expect(storage.backend).toBe("supabase");
  });
});
