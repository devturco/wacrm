import type { Message } from "@/types";
import { extractLinks } from "./links";

/** How many rows enter a page. */
export const MEDIA_PAGE_SIZE = 60;

/** The three tabs of the contact's media panel. */
export type ContactMediaKind = "media" | "documents" | "links";

/** A link found in a message, with the message it came from. */
export interface ContactLinkItem {
  /** `messageId` + the url — a message can carry more than one link. */
  id: string;
  url: string;
  /** The text around the link, when there is any. */
  title: string;
  /** The host, for display. */
  domain: string;
  /** When the message was sent. */
  createdAt: string;
  messageId: string;
}

/**
 * Every link of every message, newest message first.
 *
 * The messages arrive ordered by `created_at` (newest first), so the
 * list keeps that order: the link a customer shared last is the one on
 * top.
 */
export function buildLinkItems(messages: Message[]): ContactLinkItem[] {
  const items: ContactLinkItem[] = [];
  for (const message of messages) {
    for (const link of extractLinks(message.content_text)) {
      items.push({
        id: `${message.id}:${link.url}`,
        url: link.url,
        title: link.title,
        domain: link.domain,
        createdAt: message.created_at,
        messageId: message.id,
      });
    }
  }
  return items;
}

/**
 * Does this row belong to the "media" tab?
 *
 * The tab is what a WhatsApp Web user would call "Media": the photos,
 * videos and voice notes — not the documents.
 */
export function isMediaMessage(message: Message): boolean {
  return (
    message.content_type === "image" ||
    message.content_type === "video" ||
    message.content_type === "audio"
  );
}

/** Does this row belong to the "documents" tab? */
export function isDocumentMessage(message: Message): boolean {
  return message.content_type === "document";
}
