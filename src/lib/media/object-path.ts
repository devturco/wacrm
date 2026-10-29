/**
 * Validation of a client-supplied Storage object path.
 *
 * The path always comes to the server as a plain string, and the server
 * is the only thing that knows which account asked. Two rules have to
 * hold at once:
 *
 *  1. the path belongs to the caller's own account folder — the first
 *     segment is `account-<uuid>` (migration 020/023), which is what
 *     the bucket's RLS matches on, and what keeps the R2 backend
 *     account-scoped even though R2 has no RLS at all;
 *  2. the path is a plain object key — no `.`/`..` segments, no
 *     backslashes, no leading slash.
 *
 * The second rule is not academic: `new URL(...)` — which both the
 * pre-signer and the delete call build the endpoint with — collapses
 * `..` segments. A path like `account-<mine>/../account-<other>/x.pdf`
 * would therefore point at ANOTHER account's object, with a signature
 * that still validates.
 */
export function isAccountScopedPath(
  path: string,
  accountId: string,
): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > 1024) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.startsWith("/")) return false;

  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
  }

  return path.startsWith(`account-${accountId}/`);
}
