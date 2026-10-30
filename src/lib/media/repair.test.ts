import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (value: string) => (value === "enc" ? "token" : value),
}));

import {
  isOwnMediaUrl,
  mediaIdFromProxyUrl,
  ownMediaPrefixes,
  repairMessageMedia,
} from "./repair";
import type { MediaStorage } from "./storage";

const ACCOUNT = "acc-1";

function bytes(value: string) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(value));
      c.close();
    },
  });
}

/** A fake supabase-js: one row per table, updates collected. */
function fakeDb(rows: Record<string, unknown>) {
  const updates: { table: string; row: unknown }[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: (rows[table] as { data?: unknown } | undefined)?.data ?? null,
        error: null,
      }),
      update: (row: unknown) => {
        updates.push({ table, row });
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}

function fakeStorage(publicUrl: string) {
  const put = vi.fn(
    async (args: { path: string; contentType: string; upsert?: boolean }) => ({
      publicUrl,
      path: args.path,
      size: 3,
    }),
  );
  return { storage: { put } as unknown as MediaStorage, put };
}

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
} as Record<string, string | undefined>;

describe("ownMediaPrefixes", () => {
  it("lists the project's own public url", () => {
    expect(ownMediaPrefixes(env)).toEqual([
      "https://proj.supabase.co/storage/v1/object/public/",
    ]);
  });

  it("adds the account's public base url when there is one", () => {
    expect(ownMediaPrefixes(env, "https://media.crmbr.com")).toEqual([
      "https://proj.supabase.co/storage/v1/object/public/",
      "https://media.crmbr.com/",
    ]);
  });

  it("recognizes our own url", () => {
    const prefixes = ownMediaPrefixes(env);
    expect(
      isOwnMediaUrl(
        "https://proj.supabase.co/storage/v1/object/public/chat-media/account-1/a.png",
        prefixes,
      ),
    ).toBe(true);
    expect(
      isOwnMediaUrl("https://cdn.provider.dev/media/abc.png", prefixes),
    ).toBe(false);
  });
});

describe("mediaIdFromProxyUrl", () => {
  it("reads the id out of the proxy url", () => {
    expect(mediaIdFromProxyUrl("/api/whatsapp/media/1234567890")).toBe(
      "1234567890",
    );
  });

  it("ignores anything else", () => {
    expect(mediaIdFromProxyUrl("https://cdn.provider.dev/a.png")).toBeNull();
    expect(mediaIdFromProxyUrl("/api/whatsapp/media/")).toBeNull();
  });
});

describe("repairMessageMedia", () => {
  const message = {
    id: "m1",
    conversation_id: "conv-1",
    media_url: "/api/whatsapp/media/MEDIA123",
    media_type: "image/jpeg",
    message_id: "wamid.ABC",
    created_at: "2026-10-01T12:00:00.000Z",
  };

  it("re-mirrors the media and rewrites the row", async () => {
    const { db, updates } = fakeDb({
      messages: { data: message },
      conversations: { data: { account_id: ACCOUNT } },
      whatsapp_config: { data: { access_token: "enc" } },
    });
    const publicUrl =
      "https://proj.supabase.co/storage/v1/object/public/chat-media/account-acc-1/inbound/MEDIA123/image-20261001120000.jpg";
    const { storage, put } = fakeStorage(publicUrl);

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "m1",
      env,
      deps: {
        storage,
        meta: {
          getMediaUrl: async () => ({
            url: "https://cdn.test/a.jpg",
            mimeType: "image/jpeg",
            fileSize: 3,
          }),
          downloadMediaStream: async () => ({
            stream: bytes("abc"),
            contentType: "image/jpeg",
          }),
        },
      },
    });

    expect(outcome).toEqual({ ok: true, url: publicUrl, repaired: true });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[0]?.path).toMatch(
      /^account-acc-1\/inbound\/MEDIA123\/image-\d+\.jpg$/,
    );
    expect(put.mock.calls[0]?.[0]?.contentType).toBe("image/jpeg");
    expect(put.mock.calls[0]?.[0]?.upsert).toBe(true);
    expect(updates).toEqual([
      { table: "messages", row: { media_url: publicUrl } },
    ]);
  });

  it("answers not-found for a message of another account", async () => {
    const { db, updates } = fakeDb({
      messages: { data: message },
      conversations: { data: { account_id: "acc-other" } },
    });
    const { storage, put } = fakeStorage("https://x/y");

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "m1",
      env,
      deps: { storage },
    });

    expect(outcome).toEqual({ ok: false, reason: "not-found" });
    expect(put).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("answers not-found when the message does not exist", async () => {
    const { db } = fakeDb({ messages: { data: null } });
    const { storage, put } = fakeStorage("https://x/y");

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "nope",
      env,
      deps: { storage },
    });

    expect(outcome).toEqual({ ok: false, reason: "not-found" });
    expect(put).not.toHaveBeenCalled();
  });

  it("is idempotent when the media is already durable", async () => {
    const durable =
      "https://proj.supabase.co/storage/v1/object/public/chat-media/account-acc-1/inbound/x/a.jpg";
    const { db, updates } = fakeDb({
      messages: { data: { ...message, media_url: durable } },
      conversations: { data: { account_id: ACCOUNT } },
    });
    const { storage, put } = fakeStorage("https://other/y");

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "m1",
      env,
      deps: { storage },
    });

    expect(outcome).toEqual({ ok: true, url: durable, repaired: false });
    expect(put).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("leaves the history alone when the account moved to R2", async () => {
    // The row points at the Supabase bucket, where the object still
    // lives and keeps being served. The account switched its backend
    // afterwards: the old url keeps working, so nothing is re-uploaded
    // and nothing is rewritten. Only the attachments that arrive from
    // now on follow the new backend.
    const durable =
      "https://proj.supabase.co/storage/v1/object/public/chat-media/account-acc-1/inbound/x/a.jpg";
    const { db, updates } = fakeDb({
      messages: { data: { ...message, media_url: durable } },
      conversations: { data: { account_id: ACCOUNT } },
    });
    const { storage, put } = fakeStorage("https://media.crmbr.com/other");

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "m1",
      env: { ...env, MEDIA_PUBLIC_BASE_URL: "https://media.crmbr.com" },
      deps: { storage },
    });

    expect(outcome).toEqual({ ok: true, url: durable, repaired: false });
    expect(put).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("fetches a provider url directly and re-uploads it", async () => {
    const { db } = fakeDb({
      messages: {
        data: {
          ...message,
          media_url: "https://cdn.provider.dev/files/abc.png",
          media_type: null,
        },
      },
      conversations: { data: { account_id: ACCOUNT } },
    });
    const { storage, put } = fakeStorage(
      "https://proj.supabase.co/storage/v1/object/public/chat-media/account-acc-1/inbound/wamid_ABC/file-20261001120000.png",
    );

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "m1",
      env,
      deps: {
        storage,
        downloadPublic: async () => ({
          stream: bytes("abc"),
          contentType: "image/png",
        }),
      },
    });

    expect(outcome.ok).toBe(true);
    expect(put.mock.calls[0]?.[0]?.contentType).toBe("image/png");
  });

  it("reports the provider-missing case when the provider no longer has the bytes", async () => {
    const { db, updates } = fakeDb({
      messages: { data: message },
      conversations: { data: { account_id: ACCOUNT } },
      whatsapp_config: { data: { access_token: "enc" } },
    });
    const { storage, put } = fakeStorage("https://x/y");

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "m1",
      env,
      deps: {
        storage,
        meta: {
          getMediaUrl: async () => {
            throw new Error("Media fetch failed: 404");
          },
          downloadMediaStream: async () => ({
            stream: bytes("abc"),
            contentType: "image/jpeg",
          }),
        },
      },
    });

    expect(outcome).toEqual({ ok: false, reason: "provider-missing" });
    expect(put).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("refuses an attachment bigger than the account's ceiling", async () => {
    const { db } = fakeDb({
      messages: { data: message },
      conversations: { data: { account_id: ACCOUNT } },
      whatsapp_config: { data: { access_token: "enc" } },
    });
    const { storage, put } = fakeStorage("https://x/y");

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "m1",
      env,
      deps: {
        storage,
        meta: {
          getMediaUrl: async () => ({
            url: "https://cdn.test/a.jpg",
            mimeType: "image/jpeg",
            fileSize: 200 * 1024 * 1024,
          }),
          downloadMediaStream: async () => ({
            stream: bytes("abc"),
            contentType: "image/jpeg",
          }),
        },
      },
    });

    expect(outcome).toEqual({ ok: false, reason: "too-large" });
    expect(put).not.toHaveBeenCalled();
  });

  it("says there is nothing to restore when the message has no attachment", async () => {
    const { db } = fakeDb({
      messages: { data: { ...message, media_url: null } },
      conversations: { data: { account_id: ACCOUNT } },
    });
    const { storage, put } = fakeStorage("https://x/y");

    const outcome = await repairMessageMedia({
      db,
      accountId: ACCOUNT,
      messageId: "m1",
      env,
      deps: { storage },
    });

    expect(outcome).toEqual({ ok: false, reason: "no-media" });
    expect(put).not.toHaveBeenCalled();
  });
});
