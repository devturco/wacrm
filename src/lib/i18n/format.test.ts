import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDuration, formatNumber } from "./format";
import { APP_LOCALE } from "./locale";

// Local noon, so the date is the same one in every timezone — a UTC
// instant would slip to the previous day west of Greenwich.
const NOON = new Date(2026, 9, 22, 12, 0, 0);

describe("formatDate", () => {
  it("renders the date in the app locale", () => {
    // 'en' is pinned in vitest.config.ts.
    expect(formatDate(NOON)).toBe("10/22/2026");
  });

  it("accepts the option bag Intl takes", () => {
    expect(
      formatDate(NOON, { month: "short", day: "numeric", year: "numeric" }),
    ).toBe("Oct 22, 2026");
  });

  it("takes a Date, an ISO string or a timestamp", () => {
    expect(formatDate(NOON.toISOString())).toBe("10/22/2026");
    expect(formatDate(NOON.getTime())).toBe("10/22/2026");
  });

  it("is pinned to the app locale, not the runtime's", () => {
    // Regression guard: with no locale argument these would follow the
    // host — the server's on the first render, the visitor's browser
    // after hydration — and the two would disagree.
    expect(formatDate(NOON)).toBe(NOON.toLocaleDateString(APP_LOCALE));
  });
});

describe("formatDateTime", () => {
  it("renders date and time in the app locale", () => {
    expect(formatDateTime(NOON)).toContain("10/22/2026");
  });
});

describe("formatNumber", () => {
  it("groups with the app locale's separator", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});

describe("formatDuration", () => {
  it("renders the number with its unit", () => {
    // 'en' is pinned in vitest.config.ts.
    expect(formatDuration(30_000)).toBe("30 seconds");
    expect(formatDuration(2 * 60_000)).toBe("2 minutes");
    expect(formatDuration(90 * 60_000)).toBe("2 hours");
    expect(formatDuration(50 * 60 * 60_000)).toBe("2 days");
  });

  it("ignores the sign of the duration", () => {
    expect(formatDuration(-2 * 60_000)).toBe("2 minutes");
  });
});
