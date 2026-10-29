/**
 * The 8-character code that ties a browser click to the first
 * inbound message of that lead.
 *
 * The lead clicks an ad, the browser leaves for WhatsApp, and no
 * cookie crosses that boundary. The only bridge left is a short code
 * the client carries in the message: `ref A7X9K2M4`. The CRM strips
 * it before the agent sees the text and keeps the raw text in
 * `lead_origins.meta.raw_text`.
 *
 * 8 characters of a 32-symbol alphabet is ~40 bits. The code is
 * single-use: once it is tied to a contact it stops matching.
 */

/** The length of the code. */
export const LEAD_TOKEN_LENGTH = 8;

/**
 * The alphabet. Base32 minus the four ambiguous symbols (I, O, 0,
 * 1) — a code read aloud or copied by hand has to survive that.
 */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `ref A7X9K2M4` — the code, preceded by the marker. */
const TOKEN_PATTERN = new RegExp(
  `\\bref\\s+([${TOKEN_ALPHABET}]{${LEAD_TOKEN_LENGTH}})\\b`,
  'i',
);

/** A single code from the alphabet. */
export function generateLeadToken(random: () => number = Math.random): string {
  let token = '';
  for (let i = 0; i < LEAD_TOKEN_LENGTH; i++) {
    const index = Math.floor(random() * TOKEN_ALPHABET.length);
    token += TOKEN_ALPHABET[index] ?? 'A';
  }
  return token;
}

/** Is this a well-formed code? */
export function isLeadToken(value: string): boolean {
  return new RegExp(`^[${TOKEN_ALPHABET}]{${LEAD_TOKEN_LENGTH}}$`).test(value);
}

/** Uppercase and trim — the code is case-insensitive on the wire. */
export function normalizeLeadToken(value: string): string {
  return value.trim().toUpperCase();
}

/** The code found in a message, and the message without it. */
export interface ExtractedLeadToken {
  token: string;
  /** The text the agent will read. */
  text: string;
}

/**
 * Pull the code out of an inbound message.
 *
 * Returns null when there is no code — the common case. The text
 * comes back with the code removed and the leftover spaces tidied,
 * so the agent reads what the customer actually typed.
 */
export function extractLeadToken(
  text: string | null | undefined
): ExtractedLeadToken | null {
  if (!text) return null;

  const match = TOKEN_PATTERN.exec(text);
  if (!match || match.index === undefined) return null;

  const token = normalizeLeadToken(match[1] ?? '');
  if (!isLeadToken(token)) return null;

  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const cleaned = `${before} ${after}`.replace(/[ \t]{2,}/g, ' ').trim();

  return { token, text: cleaned };
}
