import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "" as string,
  settings: null as Record<string, unknown> | null,
  upsertError: null as { message: string } | null,
  upserts: [] as { table: string; row: Record<string, unknown> }[],
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
  requireRole: async (min: string) => {
    h.role = min;
    return {
      accountId: "acc-1",
      userId: "user-1",
      role: "admin",
      supabase: {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: h.settings, error: null }),
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            h.upserts.push({ table, row });
            return { data: null, error: h.upsertError };
          },
        }),
      },
    };
  },
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : "error" },
    status: 500,
  }),
}));

import { GET, PUT } from "./route";

type Res = { status: number; body: Record<string, unknown> };

function put(body: unknown) {
  return PUT(
    new Request("http://t/api/media/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<Res>;
}

beforeEach(() => {
  h.role = "";
  h.settings = null;
  h.upsertError = null;
  h.upserts = [];
  vi.stubEnv("R2_ACCOUNT_ID", "");
  vi.stubEnv("R2_ACCESS_KEY_ID", "");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
  vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/media/settings", () => {
  it("falls back to the default when the account never configured anything", async () => {
    const res = (await GET()) as unknown as Res;

    expect(res.status).toBe(200);
    expect(res.body.backend).toBe("supabase");
    expect(res.body.bucket).toBe("chat-media");
    expect(res.body.maxFileBytes).toBe(104857600);
  });

  it("returns the account's configuration", async () => {
    h.settings = {
      backend: "r2",
      bucket: "crmbr-media",
      max_file_bytes: 52428800,
      public_base_url: "https://media.test",
    };

    const res = (await GET()) as unknown as Res;

    expect(res.body.backend).toBe("r2");
    expect(res.body.bucket).toBe("crmbr-media");
    expect(res.body.maxFileBytes).toBe(52428800);
    expect(res.body.publicBaseUrl).toBe("https://media.test");
  });

  it("names the missing R2 variables, never their values", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "r2-account");
    vi.stubEnv("R2_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "super-secret");
    // no MEDIA_PUBLIC_BASE_URL

    const res = (await GET()) as unknown as Res;

    expect(res.body.r2Configured).toBe(false);
    expect(res.body.r2Missing).toEqual(["MEDIA_PUBLIC_BASE_URL"]);
    // The secret never travels.
    expect(JSON.stringify(res.body)).not.toContain("super-secret");
    expect(JSON.stringify(res.body)).not.toContain("AKIA_TEST");
  });

  it("says the R2 is ready when every variable is there", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "r2-account");
    vi.stubEnv("R2_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "https://media.test");

    const res = (await GET()) as unknown as Res;

    expect(res.body.r2Configured).toBe(true);
    expect(res.body.r2Missing).toEqual([]);
  });

  it("does not ask for the env base url when the account set its own", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "r2-account");
    vi.stubEnv("R2_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    h.settings = {
      backend: "r2",
      bucket: "crmbr-media",
      max_file_bytes: 104857600,
      public_base_url: "https://media.test",
    };

    const res = (await GET()) as unknown as Res;

    expect(res.body.r2Configured).toBe(true);
    expect(res.body.r2Missing).toEqual([]);
  });
});

describe("PUT /api/media/settings", () => {
  it("asks for the admin role", async () => {
    await put({
      backend: "supabase",
      bucket: "chat-media",
      maxFileBytes: 104857600,
      publicBaseUrl: null,
    });

    expect(h.role).toBe("admin");
  });

  it("saves the configuration", async () => {
    const res = await put({
      backend: "r2",
      bucket: "crmbr-media",
      maxFileBytes: 52428800,
      publicBaseUrl: "https://media.test",
    });

    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]?.table).toBe("media_settings");
    expect(h.upserts[0]?.row).toMatchObject({
      account_id: "acc-1",
      backend: "r2",
      bucket: "crmbr-media",
      max_file_bytes: 52428800,
      public_base_url: "https://media.test",
    });
  });

  it("refuses an unknown backend", async () => {
    const res = await put({
      backend: "dropbox",
      bucket: "chat-media",
      maxFileBytes: 104857600,
    });

    expect(res.status).toBe(400);
    expect(h.upserts).toHaveLength(0);
  });

  it("refuses a size that is not one of the options", async () => {
    const res = await put({
      backend: "supabase",
      bucket: "chat-media",
      maxFileBytes: 999999999,
    });

    expect(res.status).toBe(400);
    expect(h.upserts).toHaveLength(0);
  });

  it("refuses a bucket name that is not a bucket name", async () => {
    const res = await put({
      backend: "supabase",
      bucket: "Chat Media!",
      maxFileBytes: 104857600,
    });

    expect(res.status).toBe(400);
    expect(h.upserts).toHaveLength(0);
  });

  it("refuses a public base url that is not http", async () => {
    const res = await put({
      backend: "r2",
      bucket: "crmbr-media",
      maxFileBytes: 104857600,
      publicBaseUrl: "javascript:alert(1)",
    });

    expect(res.status).toBe(400);
    expect(h.upserts).toHaveLength(0);
  });

  it("drops the trailing slash of the public base url", async () => {
    await put({
      backend: "r2",
      bucket: "crmbr-media",
      maxFileBytes: 104857600,
      publicBaseUrl: "https://media.test/",
    });

    expect(h.upserts[0]?.row.public_base_url).toBe("https://media.test");
  });

  it("treats an empty public base url as none", async () => {
    await put({
      backend: "supabase",
      bucket: "chat-media",
      maxFileBytes: 104857600,
      publicBaseUrl: "",
    });

    expect(h.upserts[0]?.row.public_base_url).toBeNull();
  });
});
