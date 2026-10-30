import { describe, expect, it } from "vitest";
import { LAST_MESSAGE_KINDS, lastMessageKind } from "./last-message";

describe("lastMessageKind", () => {
  it("reads the marker of a media message", () => {
    expect(lastMessageKind("[image]")).toBe("image");
    expect(lastMessageKind("[document]")).toBe("document");
    expect(lastMessageKind("[audio]")).toBe("audio");
    expect(lastMessageKind("[video]")).toBe("video");
  });

  it("reads the markers the providers and the composer write", () => {
    for (const kind of LAST_MESSAGE_KINDS) {
      expect(lastMessageKind(`[${kind}]`)).toBe(kind);
    }
  });

  it("ignores the casing and the padding", () => {
    expect(lastMessageKind("  [Image]  ")).toBe("image");
  });

  it("leaves a real message alone", () => {
    expect(lastMessageKind("Bom dia, tudo bem?")).toBeNull();
    expect(lastMessageKind("")).toBeNull();
    expect(lastMessageKind(null)).toBeNull();
  });

  it("leaves a bracketed sentence alone — that is prose", () => {
    expect(lastMessageKind("[orçamento]")).toBeNull();
  });

  it("leaves an unknown marker alone — the row shows what it says", () => {
    expect(lastMessageKind("[Unsupported message type: button]")).toBeNull();
    expect(lastMessageKind("[whatever]")).toBeNull();
  });
});
