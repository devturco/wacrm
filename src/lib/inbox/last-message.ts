// ============================================================
// The one line the conversation list shows under the contact's name.
//
// A picture, a document, a voice note — none of them carry text, so
// the row keeps a MARKER instead: `[image]`, `[document]`, `[audio]`.
// The marker is what the DATABASE holds (the webhooks and the composer
// write it), and the translation happens here, at render time: the same
// row reads "Imagem" in Portuguese and "Image" in English, without
// rewriting a single line of history.
//
// The markers are written in several places — the Meta webhook
// (`[${message.type}]`), the other provider (`[${message.kind}]`), the
// composer (`[${messageType}]`) — so the list below is the one place
// that knows every spelling.
// ============================================================

/** The markers the app knows how to name. */
export const LAST_MESSAGE_KINDS = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "buttons",
  "button",
  "list",
  "template",
  "reaction",
  "unknown",
] as const;

export type LastMessageKind = (typeof LAST_MESSAGE_KINDS)[number];

/**
 * The marker a row carries, or null when the row carries real text.
 *
 * A marker is a word in square brackets and nothing else — a caption
 * that happens to be bracketed ("[orçamento]") is prose, and it reads
 * as prose.
 */
export function lastMessageKind(
  text: string | null | undefined,
): LastMessageKind | null {
  const match = /^\[([a-z_]+)\]$/i.exec((text ?? "").trim());
  if (!match) return null;

  const kind = match[1]!.toLowerCase();
  return (LAST_MESSAGE_KINDS as readonly string[]).includes(kind)
    ? (kind as LastMessageKind)
    : null;
}
