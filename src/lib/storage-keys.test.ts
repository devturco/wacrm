import { describe, expect, it } from "vitest";

import {
  LEGACY_BROWSER_NOTIFY_KEY,
  LEGACY_CONTACT_PANEL_KEY,
  LEGACY_FLOW_EDITOR_VIEW_KEY,
  LEGACY_MODE_KEY,
  LEGACY_THEME_KEY,
  readWithLegacy,
  writeKey,
} from "./storage-keys";

/** Minimal in-memory `Storage` — enough for the two helpers. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe("readWithLegacy", () => {
  it("prefers the new key", () => {
    const s = fakeStorage({ "crmbr.theme": "violet", "wacrm.theme": "rose" });
    expect(readWithLegacy(s, "crmbr.theme", "wacrm.theme")).toBe("violet");
  });

  it("falls back to the legacy key when the new one was never written", () => {
    const s = fakeStorage({ "wacrm.theme": "rose" });
    expect(readWithLegacy(s, "crmbr.theme", "wacrm.theme")).toBe("rose");
  });

  it("returns null when neither key holds a value", () => {
    const s = fakeStorage();
    expect(readWithLegacy(s, "crmbr.theme", "wacrm.theme")).toBeNull();
  });

  it("returns null instead of throwing when storage is unavailable", () => {
    expect(readWithLegacy(null, "crmbr.theme", "wacrm.theme")).toBeNull();
    expect(readWithLegacy(undefined, "crmbr.theme", "wacrm.theme")).toBeNull();
  });

  it("survives a storage that throws on read", () => {
    const hostile = {
      getItem: () => {
        throw new Error("private browsing");
      },
    };
    expect(readWithLegacy(hostile, "crmbr.theme", "wacrm.theme")).toBeNull();
  });
});

describe("writeKey", () => {
  it("writes the value and drops the legacy entry", () => {
    const s = fakeStorage({ "wacrm.theme": "rose" });
    writeKey(s, "crmbr.theme", "wacrm.theme", "violet");
    expect(s.store.get("crmbr.theme")).toBe("violet");
    expect(s.store.has("wacrm.theme")).toBe(false);
  });

  it("removes the new key when the value is null", () => {
    const s = fakeStorage({ "crmbr.theme": "violet" });
    writeKey(s, "crmbr.theme", "wacrm.theme", null);
    expect(s.store.has("crmbr.theme")).toBe(false);
  });

  it("clears the legacy entry too — opting out must not read back as opted in", () => {
    const s = fakeStorage({ "wacrm:browser-notifications": "1" });
    writeKey(s, "crmbr:browser-notifications", "wacrm:browser-notifications", null);
    expect(s.store.has("wacrm:browser-notifications")).toBe(false);
    expect(
      readWithLegacy(
        s,
        "crmbr:browser-notifications",
        "wacrm:browser-notifications",
      ),
    ).toBeNull();
  });

  it("does nothing when storage is unavailable", () => {
    expect(() => writeKey(null, "crmbr.theme", "wacrm.theme", "violet")).not.toThrow();
  });

  it("does not throw when storage refuses to write", () => {
    const hostile = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => writeKey(hostile, "crmbr.theme", "wacrm.theme", "violet")).not.toThrow();
  });
});

describe("the legacy key constants", () => {
  it("are the pre-rebrand names", () => {
    expect(LEGACY_THEME_KEY).toBe("wacrm.theme");
    expect(LEGACY_MODE_KEY).toBe("wacrm.mode");
    expect(LEGACY_BROWSER_NOTIFY_KEY).toBe("wacrm:browser-notifications");
    expect(LEGACY_CONTACT_PANEL_KEY).toBe("wacrm:inbox:contact-panel-open");
    expect(LEGACY_FLOW_EDITOR_VIEW_KEY).toBe("wacrm.flowEditor.view");
  });
});
