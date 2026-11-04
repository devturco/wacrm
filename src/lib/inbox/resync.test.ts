import { describe, expect, it } from "vitest";
import { RESYNC_AFTER_HIDDEN_MS, shouldResyncOnVisible } from "./resync";

describe("shouldResyncOnVisible", () => {
  it("ignora um alt-tab curto", () => {
    expect(shouldResyncOnVisible(0)).toBe(false);
    expect(shouldResyncOnVisible(5_000)).toBe(false);
    expect(shouldResyncOnVisible(RESYNC_AFTER_HIDDEN_MS - 1)).toBe(false);
  });

  it("ressincroniza a partir do limite", () => {
    expect(shouldResyncOnVisible(RESYNC_AFTER_HIDDEN_MS)).toBe(true);
    expect(shouldResyncOnVisible(5 * 60_000)).toBe(true);
  });
});