import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  removed: [] as string[],
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
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : "error" },
    status: 500,
  }),
}));

vi.mock("@/lib/media/storage", () => ({
  readMediaSettings: async () => ({
    backend: "supabase",
    bucket: "chat-media",
    maxFileBytes: 104857600,
    publicBaseUrl: null,
  }),
  resolveBucket: (settings: { bucket: string }, requested: string) =>
    requested === "chat-media" ? settings.bucket : requested,
  mediaStorageFor: () => ({
    backend: "supabase",
    bucket: "chat-media",
    maxFileBytes: 104857600,
    prepareUpload: async () => ({}),
    remove: async (path: string) => {
      h.removed.push(path);
    },
  }),
}));

import { DELETE } from "./route";

function del(body: Record<string, unknown>) {
  return DELETE(
    new Request("http://t/api/media/delete", {
      method: "DELETE",
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>;
}

beforeEach(() => {
  h.removed = [];
});

describe("DELETE /api/media/delete", () => {
  it("removes an object inside the caller's own account folder", async () => {
    const res = await del({ path: "account-acc-1/1700000000-note.pdf" });

    expect(res.status).toBe(200);
    expect(h.removed).toEqual(["account-acc-1/1700000000-note.pdf"]);
  });

  it("refuses a path from another account and never touches the storage", async () => {
    const res = await del({ path: "account-acc-2/1700000000-note.pdf" });

    expect(res.status).toBe(404);
    expect(h.removed).toHaveLength(0);
  });

  it("refuses a path that tries to climb out of the account folder", async () => {
    const res = await del({ path: "account-acc-1/../account-acc-2/note.pdf" });

    expect(res.status).toBe(404);
    expect(h.removed).toHaveLength(0);
  });

  it("refuses an empty path", async () => {
    const res = await del({ path: "   " });

    expect(res.status).toBe(400);
    expect(h.removed).toHaveLength(0);
  });
});
