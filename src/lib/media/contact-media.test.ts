import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import {
  buildLinkItems,
  isDocumentMessage,
  isMediaMessage,
  MEDIA_PAGE_SIZE,
} from "./contact-media";

function message(overrides: Partial<Message>): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    sender_type: "customer",
    content_type: "text",
    status: "sent",
    created_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildLinkItems", () => {
  it("flattens the links of every message", () => {
    const items = buildLinkItems([
      message({
        id: "m1",
        content_text: "https://a.com/1 https://b.com/2",
        created_at: "2026-10-02T12:00:00.000Z",
      }),
      message({
        id: "m2",
        content_text: "olha https://c.com/3",
        created_at: "2026-10-01T12:00:00.000Z",
      }),
    ]);

    expect(items.map((i) => i.url)).toEqual([
      "https://a.com/1",
      "https://b.com/2",
      "https://c.com/3",
    ]);
    expect(items[2]?.domain).toBe("c.com");
    expect(items[2]?.messageId).toBe("m2");
  });

  it("gives each link of a message its own id", () => {
    const items = buildLinkItems([
      message({ id: "m1", content_text: "https://a.com/1 https://b.com/2" }),
    ]);

    expect(items[0]?.id).not.toBe(items[1]?.id);
  });

  it("returns nothing for messages without links", () => {
    expect(buildLinkItems([message({ content_text: "só texto" })])).toEqual([]);
  });
});

describe("isMediaMessage", () => {
  it("takes the photos, videos and voice notes", () => {
    expect(isMediaMessage(message({ content_type: "image" }))).toBe(true);
    expect(isMediaMessage(message({ content_type: "video" }))).toBe(true);
    expect(isMediaMessage(message({ content_type: "audio" }))).toBe(true);
  });

  it("leaves the documents and the text out", () => {
    expect(isMediaMessage(message({ content_type: "document" }))).toBe(false);
    expect(isMediaMessage(message({ content_type: "text" }))).toBe(false);
  });
});

describe("isDocumentMessage", () => {
  it("takes only the documents", () => {
    expect(isDocumentMessage(message({ content_type: "document" }))).toBe(true);
    expect(isDocumentMessage(message({ content_type: "image" }))).toBe(false);
  });
});

describe("MEDIA_PAGE_SIZE", () => {
  it("brings sixty rows per page", () => {
    expect(MEDIA_PAGE_SIZE).toBe(60);
  });
});
