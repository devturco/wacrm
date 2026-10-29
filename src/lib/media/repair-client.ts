/**
 * The browser side of the on-demand restore.
 *
 * The server route answers with a translated message, but the panel
 * speaks the browser's language, not the server's — so the status code
 * is what travels back, and the caller picks the string.
 */

/** Why the restore didn't happen. */
export type RepairFailure = "nothing" | "missing" | "tooLarge" | "failed";

export type RepairResult =
  | { ok: true; url: string; repaired: boolean }
  | { ok: false; reason: RepairFailure };

export async function repairMediaUrl(
  messageId: string,
): Promise<RepairResult> {
  let response: Response;
  try {
    response = await fetch("/api/media/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
  } catch {
    return { ok: false, reason: "failed" };
  }

  if (response.ok) {
    const body = (await response.json().catch(() => null)) as {
      url?: unknown;
      repaired?: unknown;
    } | null;
    if (typeof body?.url !== "string" || !body.url) {
      return { ok: false, reason: "failed" };
    }
    return {
      ok: true,
      url: body.url,
      repaired: body.repaired === true,
    };
  }

  switch (response.status) {
    case 400:
      return { ok: false, reason: "nothing" };
    case 404:
    case 410:
      return { ok: false, reason: "missing" };
    case 413:
      return { ok: false, reason: "tooLarge" };
    default:
      return { ok: false, reason: "failed" };
  }
}
