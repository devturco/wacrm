// ============================================================
// Presence heartbeat — the vocabulary of a failed beat.
//
// The heartbeat is BEST EFFORT: a beat that does not land is not a
// broken app, it is a beat that did not land. What matters is
// telling the two apart:
//
//   'network' — the request never reached the server. The browser
//     could not fetch: the machine lost the connection, the Wi-Fi
//     changed, the tab was frozen or discarded while the user was
//     away. Expected, invisible, and fixed by the next beat.
//
//   'server'  — the server answered and said no: the RPC is missing,
//     the RLS refused it, the payload is wrong. That is a
//     misconfiguration, and it deserves to be seen.
//
// Pure helpers, no I/O — unit-testable on their own.
// ============================================================

/** How long to wait before retrying a beat the network swallowed. */
export const PRESENCE_RETRY_MS = 5_000;

/**
 * The messages browsers use when the request never left the machine.
 *
 * Each browser words it differently, and the PostgREST client prefixes
 * the error with the exception name ("TypeError: Failed to fetch").
 * The status code (0) is the stronger signal — this list is the belt
 * to its braces, for the callers that do not get one.
 */
const NETWORK_FAILURE_MESSAGES = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "load failed",
  "the internet connection appears to be offline",
  "err_internet_disconnected",
  "err_network_changed",
  "err_name_not_resolved",
];

/** What a failed beat means. */
export type PresenceBeatFailure = "network" | "server";

/** The bits of the PostgREST error the classifier looks at. */
export interface PresenceBeatError {
  message?: string | null;
  code?: string | null;
}

/**
 * Tell a swallowed request from a refused one.
 *
 * @param error  what the client answered with
 * @param status the HTTP status — 0 when the request never reached
 *               the server (that is what the PostgREST client
 *               answers for a failed fetch)
 */
export function classifyPresenceBeatFailure(
  error: PresenceBeatError | null | undefined,
  status?: number | null,
): PresenceBeatFailure {
  // No HTTP response at all: the fetch itself failed.
  if (status === 0) return "network";

  const message = (error?.message ?? "").toLowerCase();
  if (NETWORK_FAILURE_MESSAGES.some((known) => message.includes(known))) {
    return "network";
  }

  return "server";
}
