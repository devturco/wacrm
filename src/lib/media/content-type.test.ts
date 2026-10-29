import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_MIME_TYPE,
  INLINE_SAFE_MIME_TYPES,
  isInlineSafeMime,
  normalizeContentType,
} from "./content-type";

describe("normalizeContentType", () => {
  it("keeps the types that are safe to render inline", () => {
    expect(normalizeContentType("image/png")).toBe("image/png");
    expect(normalizeContentType("application/pdf")).toBe("application/pdf");
    expect(normalizeContentType("image/jpg")).toBe("image/jpg");
    expect(normalizeContentType("video/mp4")).toBe("video/mp4");
    expect(normalizeContentType("audio/ogg")).toBe("audio/ogg");
    expect(normalizeContentType("application/vnd.oasis.opendocument.text")).toBe(
      "application/vnd.oasis.opendocument.text",
    );
  });

  it("drops the parameters of the type", () => {
    expect(normalizeContentType("image/jpeg; charset=binary")).toBe("image/jpeg");
    expect(normalizeContentType("AUDIO/OGG")).toBe("audio/ogg");
    expect(normalizeContentType("  application/pdf  ")).toBe("application/pdf");
  });

  it("turns active content into a download", () => {
    expect(normalizeContentType("text/html")).toBe(DOWNLOAD_MIME_TYPE);
    expect(normalizeContentType("image/svg+xml")).toBe(DOWNLOAD_MIME_TYPE);
    expect(normalizeContentType("application/xhtml+xml")).toBe(
      DOWNLOAD_MIME_TYPE,
    );
  });

  it("turns an unknown format into a download", () => {
    expect(normalizeContentType("application/zip")).toBe(DOWNLOAD_MIME_TYPE);
    expect(normalizeContentType("application/vnd.ms-cab-compressed")).toBe(
      DOWNLOAD_MIME_TYPE,
    );
    expect(normalizeContentType("image/heic")).toBe(DOWNLOAD_MIME_TYPE);
    expect(normalizeContentType("text/csv")).toBe(DOWNLOAD_MIME_TYPE);
  });

  it("answers the catch-all when there is no type at all", () => {
    expect(normalizeContentType(null)).toBe(DOWNLOAD_MIME_TYPE);
    expect(normalizeContentType(undefined)).toBe(DOWNLOAD_MIME_TYPE);
    expect(normalizeContentType("")).toBe(DOWNLOAD_MIME_TYPE);
    expect(normalizeContentType("nonsense")).toBe(DOWNLOAD_MIME_TYPE);
    expect(normalizeContentType("/")).toBe(DOWNLOAD_MIME_TYPE);
  });

  it("never declares a type the bucket would refuse", () => {
    for (const mime of INLINE_SAFE_MIME_TYPES) {
      expect(normalizeContentType(mime)).toBe(mime);
    }
  });
});

describe("isInlineSafeMime", () => {
  it("accepts the safe types", () => {
    expect(isInlineSafeMime("image/png")).toBe(true);
    expect(isInlineSafeMime("application/pdf")).toBe(true);
  });

  it("refuses active and unknown types", () => {
    expect(isInlineSafeMime("text/html")).toBe(false);
    expect(isInlineSafeMime("application/zip")).toBe(false);
    expect(isInlineSafeMime(null)).toBe(false);
  });
});
