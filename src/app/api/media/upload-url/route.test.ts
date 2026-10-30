import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  backend: "supabase" as "supabase" | "r2",
  bucket: "chat-media",
  maxFileBytes: 104857600,
  prepared: [] as {
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }[],
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: async () => ({
    accountId: "acc-1",
    userId: "user-1",
    role: "agent",
    supabase: {},
    account: { id: "acc-1", name: "Storm Eletronicos" },
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : "error" },
    status: 500,
  }),
}));

vi.mock("@/lib/media/storage", () => ({
  readMediaSettings: async () => ({
    backend: h.backend,
    bucket: h.bucket,
    maxFileBytes: h.maxFileBytes,
    publicBaseUrl: null,
  }),
  resolveBucket: (settings: { bucket: string }, requested: string) =>
    requested === "chat-media" ? settings.bucket : requested,
  mediaStorageFor: () => ({
    backend: h.backend,
    bucket: h.bucket,
    maxFileBytes: h.maxFileBytes,
    prepareUpload: async (args: {
      fileName: string;
      contentType: string;
      sizeBytes: number;
    }) => {
      h.prepared.push(args);
      return {
        mode: h.backend === "r2" ? "presigned" : "supabase",
        path: `account-acc-1/documentos/${args.fileName}`,
        bucket: h.bucket,
        url: h.backend === "r2" ? "https://signed.test/object" : undefined,
        headers:
          h.backend === "r2"
            ? { "Content-Type": args.contentType }
            : undefined,
        publicUrl: "https://cdn.test/object",
      };
    },
  }),
}));

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/media/upload-url", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>;
}

beforeEach(() => {
  h.backend = "supabase";
  h.bucket = "chat-media";
  h.maxFileBytes = 104857600;
  h.prepared = [];
});

describe("POST /api/media/upload-url", () => {
  it("answers with a target scoped to the caller's account", async () => {
    const res = await post({
      fileName: "invoice.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(res.status).toBe(200);
    expect(res.body.path).toBe("account-acc-1/documentos/invoice.pdf");
    expect(res.body.mode).toBe("supabase");
    expect(h.prepared[0]?.fileName).toBe("invoice.pdf");
  });

  it("declares an unknown format as a download, never as active content", async () => {
    await post({
      fileName: "page.html",
      contentType: "text/html",
      sizeBytes: 10,
    });

    expect(h.prepared[0]?.contentType).toBe("application/octet-stream");
  });

  it("keeps a safe type as it is", async () => {
    await post({
      fileName: "photo.png",
      contentType: "image/png",
      sizeBytes: 10,
    });

    expect(h.prepared[0]?.contentType).toBe("image/png");
  });

  it("refuses a file above the account's ceiling", async () => {
    h.maxFileBytes = 1024;

    const res = await post({
      fileName: "big.mp4",
      contentType: "video/mp4",
      sizeBytes: 4096,
    });

    expect(res.status).toBe(413);
    expect(h.prepared).toHaveLength(0);
  });

  it("refuses a request with no file name", async () => {
    const res = await post({ contentType: "application/pdf", sizeBytes: 10 });

    expect(res.status).toBe(400);
    expect(h.prepared).toHaveLength(0);
  });

  it("writes to the account's own bucket, whatever it is named", async () => {
    // The browser says "chat-media"; the account named its bucket
    // "atacados". The upload must follow the ACCOUNT — otherwise the
    // composer writes to one bucket and the inbound mirror to another,
    // and the account's media ends up split in two.
    h.bucket = "atacados";

    const res = await post({
      fileName: "invoice.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe("atacados");
  });

  it("hands back a pre-signed URL when the account is on R2", async () => {
    h.backend = "r2";

    const res = await post({
      fileName: "invoice.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(res.body.mode).toBe("presigned");
    expect(res.body.url).toBe("https://signed.test/object");
    expect(res.body.headers).toEqual({ "Content-Type": "application/pdf" });
  });
});
