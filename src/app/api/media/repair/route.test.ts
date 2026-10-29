import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  outcome: {
    ok: true,
    url: "https://cdn.test/a.jpg",
    repaired: true,
  } as unknown,
  calls: [] as { accountId: string; messageId: string }[],
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

vi.mock("@/lib/media/repair", () => ({
  repairMessageMedia: async (args: { accountId: string; messageId: string }) => {
    h.calls.push({ accountId: args.accountId, messageId: args.messageId });
    return h.outcome;
  },
}));

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/media/repair", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>;
}

beforeEach(() => {
  h.outcome = { ok: true, url: "https://cdn.test/a.jpg", repaired: true };
  h.calls = [];
});

describe("POST /api/media/repair", () => {
  it("repairs the message of the caller's account", async () => {
    const res = await post({ messageId: "m1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: "https://cdn.test/a.jpg",
      repaired: true,
    });
    expect(h.calls).toEqual([{ accountId: "acc-1", messageId: "m1" }]);
  });

  it("refuses a request with no message id", async () => {
    const res = await post({});

    expect(res.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it("answers 404 for a message of another account", async () => {
    h.outcome = { ok: false, reason: "not-found" };

    const res = await post({ messageId: "m1" });

    expect(res.status).toBe(404);
  });

  it("answers 410 when the provider no longer holds the bytes", async () => {
    h.outcome = { ok: false, reason: "provider-missing" };

    const res = await post({ messageId: "m1" });

    expect(res.status).toBe(410);
    // The message never names the provider.
    expect(String(res.body.error)).not.toMatch(/whatsmiau|crmbr/i);
  });

  it("answers 413 for an attachment over the ceiling", async () => {
    h.outcome = { ok: false, reason: "too-large" };

    const res = await post({ messageId: "m1" });

    expect(res.status).toBe(413);
  });

  it("answers 500 when the storage fails", async () => {
    h.outcome = { ok: false, reason: "failed" };

    const res = await post({ messageId: "m1" });

    expect(res.status).toBe(500);
  });
});
