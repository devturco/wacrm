import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

import { classifyPresenceBeatFailure } from "./presence-heartbeat";

/**
 * The heartbeat is best effort, so a beat that does not land must not
 * be reported as an error — but a server-side refusal still must be.
 * The classifier tells the two apart; these tests pin both the rule
 * and the shape the real client answers with.
 */
describe("classifyPresenceBeatFailure", () => {
  it("calls a request that never reached the server a network failure", () => {
    // No HTTP response at all: the fetch itself failed.
    expect(
      classifyPresenceBeatFailure(
        { message: "TypeError: Failed to fetch" },
        0,
      ),
    ).toBe("network");
  });

  it("recognises the browser wording even without a status", () => {
    expect(
      classifyPresenceBeatFailure({ message: "TypeError: Failed to fetch" }),
    ).toBe("network");
    expect(
      classifyPresenceBeatFailure({
        message: "NetworkError when attempting to fetch resource.",
      }),
    ).toBe("network");
    expect(
      classifyPresenceBeatFailure({
        message: "Load failed",
      }),
    ).toBe("network");
  });

  it("treats an answer from the server as a server failure", () => {
    expect(
      classifyPresenceBeatFailure(
        { message: "No account for caller", code: "22023" },
        400,
      ),
    ).toBe("server");
    expect(
      classifyPresenceBeatFailure({
        message: "Could not find the function public.touch_presence",
        code: "PGRST202",
      }),
    ).toBe("server");
  });
});

describe("what the PostgREST client answers", () => {
  it("reports a failed fetch with status 0 — a network failure", async () => {
    const supabase = createClient("https://project.test", "anon-key", {
      global: {
        fetch: async () => {
          throw new TypeError("Failed to fetch");
        },
      },
    });

    const { error, status } = await supabase.rpc("touch_presence", {
      p_status: "online",
    });

    expect(status).toBe(0);
    expect(error?.message).toContain("Failed to fetch");
    expect(classifyPresenceBeatFailure(error, status)).toBe("network");
  });

  it("reports a refused request with its HTTP status — a server failure", async () => {
    const supabase = createClient("https://project.test", "anon-key", {
      global: {
        fetch: async () =>
          new Response(
            JSON.stringify({
              message: "No account for caller",
              code: "22023",
              details: null,
              hint: null,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
      },
    });

    const { error, status } = await supabase.rpc("touch_presence", {
      p_status: "online",
    });

    expect(status).toBe(400);
    expect(classifyPresenceBeatFailure(error, status)).toBe("server");
  });
});
