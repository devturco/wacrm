/**
 * The links a customer sent in a conversation.
 *
 * WhatsApp turns a bare URL into a link preview, and people share
 * documents by pasting the address — so the links in a thread are often
 * the most valuable thing in it. The panel lists them once each, with the
 * domain, so the agent can reopen the page without hunting through the
 * conversation.
 */

export interface ExtractedLink {
  /** The URL, without the fragment. */
  url: string;
  /** The text around it, when there is any. */
  title: string;
  /** The host, for display. */
  domain: string;
}

/** http/https only — `mailto:`, `tel:` and scheme-less hosts stay out. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/**
 * The links of a message's text.
 *
 * Deduplicated by the normalized URL (no fragment, no `www.`), so the same
 * address pasted twice is one entry.
 */
export function extractLinks(
  text: string | null | undefined,
): ExtractedLink[] {
  if (!text) return [];

  const found: ExtractedLink[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(URL_PATTERN)) {
    // A sentence ends with a period or a comma — it isn't part of the link.
    const raw = match[0].replace(/[.,;:!?)]+$/, "");
    const normalized = normalizeUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    found.push({
      url: raw,
      title: titleFor(text, raw),
      domain: domainOf(raw),
    });
  }

  return found;
}

/** The key a link is deduplicated by. */
function normalizeUrl(url: string): string {
  const withoutHash = url.split("#")[0] ?? url;
  return withoutHash
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

/** The host, without the `www.`. */
function domainOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/**
 * The text around the link.
 *
 * A message that is nothing but a link has no title of its own — the
 * domain says it better than the raw address does.
 */
function titleFor(text: string, url: string): string {
  const trimmed = text.trim();
  return trimmed === url ? "" : trimmed;
}
