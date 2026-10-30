import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mirrorFileName,
  mirrorInboundMedia,
  mirrorObjectPath,
  normalizeMimeType,
} from "./mirror-inbound-media";
import { fakeMediaStorage } from "@/lib/media/storage/fake-storage.test-helper";
import { CHAT_MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";

const ACCOUNT = "11111111-2222-3333-4444-555555555555";
const MEDIA_ID = "1234567890123456";

/**
 * The account's storage, standing in for the real thing. Records every
 * write so a test can assert on the object path and the content type
 * without a Supabase project.
 */
function fakeStorage(uploadError: { message: string } | null = null) {
  const fake = fakeMediaStorage(
    uploadError ? { failWith: uploadError.message } : {},
  );
  return { storage: fake.storage, uploads: fake.puts, fake };
}

/** A stream carrying `bytes` bytes, like the real downloader returns. */
function fakeStream(bytes: number) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function fakeDownload(bytes: number, contentType = "image/jpeg") {
  return vi.fn(async () => ({
    stream: fakeStream(bytes),
    contentType,
  }));
}

const BASE = {
  accountId: ACCOUNT,
  mediaId: MEDIA_ID,
  downloadUrl: "https://lookaside.fbsbx.com/whatsapp/abc",
  accessToken: "test-token",
} as const;

describe("normalizeMimeType", () => {
  it("strips parameters and lower-cases", () => {
    // What Meta actually sends for a voice note.
    expect(normalizeMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(normalizeMimeType("IMAGE/JPEG")).toBe("image/jpeg");
  });

  it("rejects values that aren't a MIME type", () => {
    expect(normalizeMimeType(null)).toBeNull();
    expect(normalizeMimeType("")).toBeNull();
    expect(normalizeMimeType("binary")).toBeNull();
  });
});

describe("mirrorFileName", () => {
  it("keeps a document's own name so the download reads sensibly", () => {
    const name = mirrorFileName({
      mimeType: "application/pdf",
      fileName: "invoice.pdf",
    });
    expect(name).toBe("invoice.pdf");
  });

  it("re-derives the extension from the MIME, not the sender's name", () => {
    // A sender-controlled ".exe" must not survive into the object path.
    const name = mirrorFileName({
      mimeType: "application/pdf",
      fileName: "../../payload.exe",
    });
    expect(name).toBe("payload.pdf");
  });

  it("synthesises a stamped name when there is no filename", () => {
    const name = mirrorFileName({
      mimeType: "image/jpeg",
      messageTimestamp: "1754899200",
    });
    expect(name).toBe("image-1754899200.jpg");
  });

  it("stays under buildMediaPath's 40-char basename cap", () => {
    // buildMediaPath silently truncates a basename past 40 characters,
    // and the timestamp stops disambiguating anything.
    const name = mirrorFileName({
      mimeType: "image/jpeg",
      messageTimestamp: "1754899200",
    });
    expect(name.replace(/\.[^.]+$/, "").length).toBeLessThanOrEqual(40);
  });

  it("falls back to a .bin extension for an unknown MIME", () => {
    const name = mirrorFileName({
      mimeType: "application/x-nonsense",
      messageTimestamp: "1754899200",
    });
    expect(name).toBe("document-1754899200.bin");
  });
});

describe("mirrorObjectPath", () => {
  it("keeps the media id in its own segment", () => {
    expect(mirrorObjectPath(ACCOUNT, MEDIA_ID, "invoice.pdf")).toBe(
      `account-${ACCOUNT}/inbound/${MEDIA_ID}/invoice.pdf`,
    );
  });

  it("sanitises an id that carries path separators", () => {
    // The whole run of unsafe characters collapses into one underscore,
    // so the id can never climb out of its own segment.
    expect(mirrorObjectPath(ACCOUNT, "../../etc", "invoice.pdf")).toBe(
      `account-${ACCOUNT}/inbound/_etc/invoice.pdf`,
    );
  });

  it("never produces an empty segment", () => {
    expect(mirrorObjectPath(ACCOUNT, "", "invoice.pdf")).toBe(
      `account-${ACCOUNT}/inbound/media/invoice.pdf`,
    );
  });
});

describe("mirrorInboundMedia", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads to chat-media and returns the durable public URL", async () => {
    const { storage, uploads } = fakeStorage();
    const download = fakeDownload(1024);

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "image/jpeg",
      fileSize: 1024,
      messageTimestamp: "1754899200",
      download,
    });

    expect(uploads).toHaveLength(1);
    expect(storage.bucket).toBe("chat-media");
    expect(uploads[0].path).toBe(
      `account-${ACCOUNT}/inbound/${MEDIA_ID}/image-1754899200.jpg`,
    );
    expect(uploads[0].contentType).toBe("image/jpeg");
    expect(url).toBe(
      `https://cdn.test/storage/chat-media/account-${ACCOUNT}/inbound/${MEDIA_ID}/image-1754899200.jpg`,
    );
  });

  it("writes to the backend the account chose — R2 when that is the setting", async () => {
    // The mirror used to be hardcoded to the Supabase bucket: an
    // account that had chosen R2 received every photo there anyway,
    // while the composer wrote to R2. Both directions now follow the
    // same setting.
    const fake = fakeMediaStorage({
      backend: "r2",
      bucket: "crmbr-media",
      publicBase: "https://media.test",
    });
    const download = fakeDownload(1024);

    const url = await mirrorInboundMedia({
      ...BASE,
      storage: fake.storage,
      mimeType: "image/jpeg",
      fileSize: 1024,
      messageTimestamp: "1754899200",
      download,
    });

    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0].path).toBe(
      `account-${ACCOUNT}/inbound/${MEDIA_ID}/image-1754899200.jpg`,
    );
    expect(url).toBe(
      `https://media.test/account-${ACCOUNT}/inbound/${MEDIA_ID}/image-1754899200.jpg`,
    );
  });

  it("writes the same path on a redelivery, so a retry can't orphan a copy", async () => {
    const { storage, uploads } = fakeStorage();
    const args = {
      ...BASE,
      storage,
      mimeType: "image/jpeg" as const,
      messageTimestamp: "1754899200",
      download: fakeDownload(1024),
    };

    await mirrorInboundMedia(args);
    await mirrorInboundMedia(args);

    expect(uploads).toHaveLength(2);
    expect(uploads[0].path).toBe(uploads[1].path);
    // upsert, so the second write replaces rather than erroring.
    expect(uploads[1].upsert).toBe(true);
  });

  it("strips MIME parameters before handing the type to Storage", async () => {
    // The bucket's allowed_mime_types is an exact-match list, so an
    // unstripped `audio/ogg; codecs=opus` would be rejected outright.
    const { storage, uploads } = fakeStorage();

    await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "audio/ogg; codecs=opus",
      download: fakeDownload(2048, "audio/ogg; codecs=opus"),
    });

    expect(uploads[0].contentType).toBe("audio/ogg");
    expect(uploads[0].path).toMatch(/\.ogg$/);
  });

  it("declares an unknown format as a download instead of refusing it", async () => {
    // The old bucket list refused this outright and the media was
    // lost. Now it is stored as the catch-all and the browser
    // downloads it.
    const { storage, uploads } = fakeStorage();

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "application/x-7z-compressed",
      download: fakeDownload(1024, "application/x-7z-compressed"),
    });

    expect(url).not.toBeNull();
    expect(uploads[0].contentType).toBe("application/octet-stream");
  });

  it("never declares active content inline", async () => {
    const { storage, uploads } = fakeStorage();

    await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "text/html",
      download: fakeDownload(1024, "text/html"),
    });

    expect(uploads[0].contentType).toBe("application/octet-stream");
  });

  it("skips oversized media without downloading it", async () => {
    const { storage, uploads } = fakeStorage();
    const download = fakeDownload(1024);

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "application/pdf",
      fileSize: CHAT_MEDIA_MAX_BYTES + 1,
      download,
    });

    expect(url).toBeNull();
    expect(download).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });

  it("hands the ceiling to the downloader so an oversized file never lands whole", async () => {
    const { storage } = fakeStorage();
    const download = fakeDownload(1024);

    await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "video/mp4",
      fileSize: 1024,
      download,
    });

    expect(download).toHaveBeenCalledWith({
      downloadUrl: BASE.downloadUrl,
      accessToken: BASE.accessToken,
      maxBytes: CHAT_MEDIA_MAX_BYTES,
    });
  });

  it("returns null when Storage refuses the upload", async () => {
    // e.g. the bucket is unreachable.
    const { storage } = fakeStorage({ message: "mime type not supported" });

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "application/x-7z-compressed",
      download: fakeDownload(1024, "application/x-7z-compressed"),
    });

    expect(url).toBeNull();
  });

  it("returns null instead of throwing when the download fails", async () => {
    // The caller is the Meta webhook: a throw here would surface as a
    // failed delivery and have Meta retry the whole message.
    const { storage } = fakeStorage();

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "image/png",
      download: vi.fn(async () => {
        throw new Error("Media download failed: 404");
      }),
    });

    expect(url).toBeNull();
  });

  it("falls back to the download's content type when Meta gave none", async () => {
    const { storage, uploads } = fakeStorage();

    await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: null,
      download: fakeDownload(1024, "image/png"),
    });

    expect(uploads[0].contentType).toBe("image/png");
  });
});
