import { describe, expect, it } from "vitest";
import {
  CHAT_MEDIA_MAX_BYTES,
  MEDIA_MAX_BYTES_BY_KIND,
} from "./upload-media";

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
