"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { HEARTBEAT_MS, IDLE_AFTER_MS, type StoredPresence } from "@/lib/presence";
import {
  PRESENCE_RETRY_MS,
  classifyPresenceBeatFailure,
} from "@/lib/presence-heartbeat";

/**
 * PresenceHeartbeat — headless. Mount ONCE per signed-in dashboard tab
 * (in the dashboard shell, below the auth gate). Reports this tab's
 * presence to the `member_presence` table via the `touch_presence` RPC
 * roughly every HEARTBEAT_MS.
 *
 * The client only ever reports 'online' or 'away':
 *   - 'away'   when the tab is hidden, or no user input for IDLE_AFTER_MS
 *   - 'online' otherwise
 * It keeps heartbeating while away (so the row stays fresh, i.e. not
 * offline). When the tab closes the beats simply stop and viewers derive
 * 'offline' from staleness — no unreliable unload write needed.
 *
 * A beat that does not land is NOT an error: the request never reached
 * the server (the machine lost the connection, the tab was frozen while
 * the user was away) — so it is retried soon after and the console
 * stays quiet. Only a server-side refusal (a missing RPC, an RLS
 * denial) is worth an error, and it is reported once instead of every
 * 30 seconds.
 */
export function PresenceHeartbeat() {
  const { accountId } = useAuth();

  // 0 = "never recorded"; set on mount so we don't read the clock during
  // render (impure). Until the effect runs the tab counts as active.
  const lastActivityRef = useRef<number>(0);

  useEffect(() => {
    // Hold off until the account is known. Beating during the brief
    // window on a fresh signup — authed but profile/account row not yet
    // created — would make touch_presence raise "No account for caller"
    // and log a spurious error. The effect re-runs once accountId lands.
    if (!accountId) return;

    const supabase = createClient();
    let cancelled = false;
    let lastBeatAt = 0;
    // A beat the network swallowed is retried soon after, so presence
    // recovers without waiting for the next full interval.
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // The last server-side failure we reported — a broken RPC must be
    // reported ONCE, not every 30 seconds.
    let reportedServerError: string | null = null;
    // The same for the network: one line per outage, not one per beat.
    let reportedNetworkFailure = false;

    lastActivityRef.current = Date.now();

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    const currentStatus = (): StoredPresence => {
      if (typeof document !== "undefined" && document.hidden) return "away";
      if (Date.now() - lastActivityRef.current > IDLE_AFTER_MS) return "away";
      return "online";
    };

    async function beat() {
      if (cancelled) return;
      // Coalesce bursts: a tab refocus fires visibilitychange AND focus
      // together, so skip a beat within 1s of the last to avoid two RPCs
      // in the same frame. The 30s interval is never affected.
      const t = Date.now();
      if (t - lastBeatAt < 1_000) return;
      lastBeatAt = t;

      // The browser knows there is no network: the request would fail
      // before leaving the machine. Wait for it to come back.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        scheduleRetry();
        return;
      }

      const { error, status } = await supabase.rpc("touch_presence", {
        p_status: currentStatus(),
      });
      if (cancelled) return;
      if (!error) {
        reportedServerError = null;
        reportedNetworkFailure = false;
        return;
      }

      if (classifyPresenceBeatFailure(error, status) === "network") {
        // The request never reached the server: the machine lost the
        // connection, or the tab was frozen while the user was away.
        // Presence is best effort — the retry below (or the beat when
        // the network returns) fixes it, so this is not an error.
        if (!reportedNetworkFailure) {
          reportedNetworkFailure = true;
          console.debug(
            "[PresenceHeartbeat] beat did not reach the server:",
            error.message,
          );
        }
        scheduleRetry();
        return;
      }

      // The server answered and said no: the RPC is missing, the RLS
      // refused it, the payload is wrong. That IS a misconfiguration —
      // say it once, not every 30 seconds.
      if (error.message !== reportedServerError) {
        reportedServerError = error.message;
        console.error(
          "[PresenceHeartbeat] touch_presence failed:",
          error.message,
        );
      }
    }

    function scheduleRetry() {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void beat();
      }, PRESENCE_RETRY_MS);
    }

    // Activity listeners. `passive` so we never block scroll/input.
    const activityEvents: (keyof DocumentEventMap)[] = [
      "mousemove",
      "keydown",
      "pointerdown",
      "scroll",
    ];
    activityEvents.forEach((e) =>
      document.addEventListener(e, markActive, { passive: true }),
    );

    // Returning to the tab should beat immediately so a member flips
    // back to online without a 30s wait. The debounce in beat() absorbs
    // the visibilitychange + focus double-fire.
    const onReturn = () => {
      if (!document.hidden) markActive();
      void beat();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);

    // The network came back: report presence right away instead of
    // waiting for the next beat.
    const onOnline = () => {
      void beat();
    };
    window.addEventListener("online", onOnline);

    void beat();
    const interval = setInterval(() => void beat(), HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (retryTimer) clearTimeout(retryTimer);
      activityEvents.forEach((e) =>
        document.removeEventListener(e, markActive),
      );
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onOnline);
    };
  }, [accountId]);

  return null;
}
