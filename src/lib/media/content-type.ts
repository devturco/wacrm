/**
 * The `Content-Type` we declare when uploading media.
 *
 * The `chat-media` bucket carries an allow-list and Storage REFUSES any
 * upload whose type is not on it. The provider often doesn't say what an
 * attachment is, and the mirror's fallback (`application/octet-stream`)
 * wasn't on the list either — so an unknown-type attachment was dropped
 * in silence and the row kept pointing at the provider's URL, which
 * expires. That is the "the media disappears" complaint.
 *
 * Here the type is normalised BEFORE the upload:
 *
 *   - a safe type (image, video, audio, PDF, text, Office, ODF) is
 *     declared as-is and the browser renders it inline;
 *   - anything else (zip, csv, heic, html, svg...) is declared
 *     `application/octet-stream` and the browser DOWNLOADS the file.
 *
 * Two independent barriers, so neither is load-bearing on its own:
 * the allow-list catches what slips past the normaliser, and the
 * normaliser makes sure active content is never served inline.
 */

/** Types the browser may render without risk. */
export const INLINE_SAFE_MIME_TYPES: ReadonlySet<string> = new Set([
  // Image
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  // Video
  "video/mp4",
  "video/3gpp",
  "video/quicktime",
  // Audio
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
  // Document
  "application/pdf",
  "text/plain",
  // Legacy Office
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  // Office OOXML
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // OpenDocument (LibreOffice) — common in Brazil
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.graphics",
]);

/** The type Storage accepts and the browser downloads instead of rendering. */
export const DOWNLOAD_MIME_TYPE = "application/octet-stream";

/** The bare type, without parameters (`; charset=...`), lowercased. */
function baseMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
}

/** May this type be served inline? */
export function isInlineSafeMime(mime: string | null | undefined): boolean {
  return INLINE_SAFE_MIME_TYPES.has(baseMime(mime));
}

/**
 * The `Content-Type` to declare on upload: the type itself when it is
 * safe, the catch-all when it is not.
 */
export function normalizeContentType(
  mime: string | null | undefined,
): string {
  const base = baseMime(mime);
  if (!base.includes("/")) return DOWNLOAD_MIME_TYPE;
  return INLINE_SAFE_MIME_TYPES.has(base) ? base : DOWNLOAD_MIME_TYPE;
}
