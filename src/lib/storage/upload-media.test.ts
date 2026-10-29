import { describe, expect, it } from "vitest";
import {
  buildMediaPath,
  CHAT_MEDIA_MAX_BYTES,
  MEDIA_MAX_BYTES_BY_KIND,
} from "./upload-media";

const ACCOUNT = "11111111-2222-3333-4444-555555555555";

describe("buildMediaPath", () => {
  it("namespaces under account-<id> so RLS write policies match", () => {
    const path = buildMediaPath(ACCOUNT, "photo.png", 1700000000000);
    expect(path).toBe(`account-${ACCOUNT}/1700000000000-photo.png`);
    expect(path.split("/")[0]).toBe(`account-${ACCOUNT}`);
  });

  it("lower-cases the extension and sanitizes the basename", () => {
    const path = buildMediaPath(ACCOUNT, "My Invoice (final).PDF", 1700000000000);
    expect(path).toBe(`account-${ACCOUNT}/1700000000000-My_Invoice_final_.pdf`);
  });

  it("caps the basename at 40 chars", () => {
    const long = "a".repeat(100) + ".png";
    const path = buildMediaPath(ACCOUNT, long, 1700000000000);
    const base = path.split("/")[1].replace("1700000000000-", "").replace(".png", "");
    expect(base.length).toBe(40);
  });

  it("falls back to 'file' / 'bin' for a nameless input", () => {
    const path = buildMediaPath(ACCOUNT, "", 1700000000000);
    expect(path).toBe(`account-${ACCOUNT}/1700000000000-file.bin`);
  });

  it("defaults the extension to bin when there is none", () => {
    const path = buildMediaPath(ACCOUNT, "README", 1700000000000);
    expect(path).toBe(`account-${ACCOUNT}/1700000000000-README.bin`);
  });

  it("omits the timestamp when passed null, for callers needing a stable path", () => {
    const path = buildMediaPath(ACCOUNT, "photo.png", null);
    expect(path).toBe(`account-${ACCOUNT}/photo.png`);
  });

  it("nests a subfolder below account-<id>, leaving the RLS segment first", () => {
    const path = buildMediaPath(ACCOUNT, "photo.png", null, "inbound");
    expect(path).toBe(`account-${ACCOUNT}/inbound/photo.png`);
    expect(path.split("/")[0]).toBe(`account-${ACCOUNT}`);
  });

  it("drops a separator smuggled into the extension", () => {
    const path = buildMediaPath(ACCOUNT, "invoice.pdf/evil", 1700000000000);
    expect(path).toBe(`account-${ACCOUNT}/1700000000000-invoice.bin`);
    expect(path.split("/")).toHaveLength(2);
  });
});

describe("MEDIA_MAX_BYTES_BY_KIND", () => {
  it("caps images at Meta's tighter 5 MB limit", () => {
    expect(MEDIA_MAX_BYTES_BY_KIND.image).toBe(5 * 1024 * 1024);
  });

  it("caps video/audio at Meta's 16 MB limit", () => {
    expect(MEDIA_MAX_BYTES_BY_KIND.video).toBe(16 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES_BY_KIND.audio).toBe(16 * 1024 * 1024);
  });

  it("gives documents Meta's full 100 MB, which the bucket now allows", () => {
    expect(MEDIA_MAX_BYTES_BY_KIND.document).toBe(100 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES_BY_KIND.document).toBe(CHAT_MEDIA_MAX_BYTES);
  });
});
