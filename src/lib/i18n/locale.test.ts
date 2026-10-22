import { describe, expect, it, vi } from "vitest";
import { APP_LOCALES, APP_LOCALE } from "./locale";

describe("APP_LOCALE", () => {
  it("is one of the locales the app ships messages for", () => {
    expect(APP_LOCALES).toContain(APP_LOCALE);
  });

  it("falls back to English for an unsupported value", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_LOCALE", "xx");
    const { APP_LOCALE: fallback } = await import("./locale");
    expect(fallback).toBe("en");
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
