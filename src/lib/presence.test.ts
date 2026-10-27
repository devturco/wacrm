import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";

import { getT } from "./i18n/translate";
import {
  OFFLINE_AFTER_MS,
  derivePresence,
  formatLastSeen,
  presenceLabel,
  summarize,
} from "./presence";

// The tooltip wording lives in the `Presence` message namespace, so
// the assertions below run against the real English catalogue — that
// is exactly the string a user reads.
const t = getT("Presence");

// A second locale, to prove the label follows the catalogue instead of
// a hardcoded English sentence.
const tPt = createTranslator({
  locale: "pt",
  messages: JSON.parse(
    readFileSync(join(process.cwd(), "messages", "pt.json"), "utf8"),
  ),
  namespace: "Presence" as never,
}) as unknown as (
  key: string,
  values?: Record<string, string | number>,
) => string;

// Fixed reference clock so every case is deterministic.
const NOW = new Date("2026-06-22T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("derivePresence", () => {
  it("returns the stored status for a fresh heartbeat", () => {
    expect(derivePresence("online", ago(1_000), NOW)).toBe("online");
    expect(derivePresence("away", ago(1_000), NOW)).toBe("away");
  });

  it("reads as offline when the heartbeat is stale", () => {
    expect(derivePresence("online", ago(OFFLINE_AFTER_MS + 1_000), NOW)).toBe(
      "offline",
    );
    // Stored 'away' goes stale to offline too (tab was closed while idle).
    expect(derivePresence("away", ago(OFFLINE_AFTER_MS + 1_000), NOW)).toBe(
      "offline",
    );
  });

  it("treats a missing row or timestamp as offline", () => {
    expect(derivePresence(undefined, null, NOW)).toBe("offline");
    expect(derivePresence("online", null, NOW)).toBe("offline");
    expect(derivePresence("online", "not-a-date", NOW)).toBe("offline");
  });

  it("stays online exactly at the threshold and flips just past it", () => {
    expect(derivePresence("online", ago(OFFLINE_AFTER_MS), NOW)).toBe("online");
    expect(derivePresence("online", ago(OFFLINE_AFTER_MS + 1), NOW)).toBe(
      "offline",
    );
  });
});

describe("formatLastSeen", () => {
  it("describes recent activity coarsely", () => {
    expect(formatLastSeen(ago(10_000), NOW, t)).toBe("just now");
    expect(formatLastSeen(ago(60_000), NOW, t)).toBe("1 minute ago");
    expect(formatLastSeen(ago(5 * 60_000), NOW, t)).toBe("5 minutes ago");
  });

  it("rolls up into hours and days", () => {
    expect(formatLastSeen(ago(60 * 60_000), NOW, t)).toBe("1 hour ago");
    expect(formatLastSeen(ago(2 * 60 * 60_000), NOW, t)).toBe("2 hours ago");
    expect(formatLastSeen(ago(24 * 60 * 60_000), NOW, t)).toBe("1 day ago");
    expect(formatLastSeen(ago(3 * 24 * 60 * 60_000), NOW, t)).toBe("3 days ago");
  });

  it("falls back gracefully on missing/invalid input", () => {
    expect(formatLastSeen(null, NOW, t)).toBe("a while ago");
    expect(formatLastSeen("nonsense", NOW, t)).toBe("a while ago");
  });
});

describe("presenceLabel", () => {
  it("labels each state for the tooltip", () => {
    expect(presenceLabel("online", ago(1_000), NOW, t)).toBe(
      "Online — active now",
    );
    expect(presenceLabel("away", ago(1_000), NOW, t)).toBe("Away — idle");
    expect(presenceLabel("offline", ago(2 * 60 * 60_000), NOW, t)).toBe(
      "Offline — last seen 2 hours ago",
    );
  });

  it("follows the locale of the catalogue it is given", () => {
    expect(presenceLabel("online", ago(1_000), NOW, tPt)).toBe(
      "Online — ativo agora",
    );
    expect(presenceLabel("away", ago(1_000), NOW, tPt)).toBe("Ausente — inativo");
    expect(presenceLabel("offline", ago(2 * 60 * 60_000), NOW, tPt)).toBe(
      "Offline — visto pela última vez há 2 horas",
    );
  });
});

describe("summarize", () => {
  it("counts each status", () => {
    expect(
      summarize(["online", "online", "online", "away", "offline"]),
    ).toEqual({ online: 3, away: 1, offline: 1 });
  });

  it("returns zeroes for an empty roster", () => {
    expect(summarize([])).toEqual({ online: 0, away: 0, offline: 0 });
  });
});
