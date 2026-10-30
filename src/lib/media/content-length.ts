/**
 * How many bytes a response body really holds.
 *
 * The `content-length` header counts the bytes AS THEY TRAVEL: a
 * compressed body (`content-encoding: gzip`) declares the size of the
 * COMPRESSED form, while the stream we forward is the DECODED one.
 * Declaring the compressed size would make the upload fail — or worse,
 * truncate the file — so an encoded body gets no length at all.
 *
 * With no length the storage adapter reads the stream whole and counts
 * it, which is slower but always correct.
 */
export function contentLengthOf(response: Response): number | null {
  const encoding = response.headers.get("content-encoding");
  if (encoding && encoding.trim().toLowerCase() !== "identity") return null;

  const raw = response.headers.get("content-length");
  if (!raw) return null;

  const length = Number.parseInt(raw, 10);
  if (!Number.isFinite(length) || length < 0) return null;
  return length;
}
