#!/usr/bin/env node
/**
 * One-shot cron drain for the automations and flows engines.
 *
 * The app itself never calls these two endpoints on a timer — a
 * scheduler has to. This script is that scheduler: it makes the two
 * HTTP calls and exits, so it can run as a Railway cron job (or from
 * any external pinger) without keeping anything open.
 *
 * Endpoints (both GET):
 *   /api/automations/cron — drains due rows from
 *                            automation_pending_executions, closes out
 *                            wait_for_reply runs whose 24h window
 *                            lapsed, requeues stalled ones.
 *   /api/flows/cron      — sweeps flow runs that finished or failed
 *                            into their terminal state.
 *
 * They are independent on purpose: one failing must not stop the
 * other. Both authenticate with the same shared secret, sent in the
 * `x-cron-secret` header, and both fail closed — no secret, no
 * request; wrong secret, 401.
 *
 * Exit code is the point: Railway marks a cron run as failed on a
 * non-zero exit, so a broken drain shows up in the deploy log
 * instead of silently doing nothing.
 */

const secret = process.env.AUTOMATION_CRON_SECRET;
const base = (process.env.CRON_BASE_URL || "https://app.crmbr.com").replace(
  /\/+$/,
  "",
);

const ENDPOINTS = ["/api/automations/cron", "/api/flows/cron"];

// The drain runs the automation engine inline, so it can take a while
// when a backlog is waiting. Long enough for a real backlog, short
// enough to finish inside the scheduler's interval.
const TIMEOUT_MS = 240_000;

if (!secret) {
  console.error(
    "[cron] AUTOMATION_CRON_SECRET is not set — refusing to call the " +
      "endpoints. Set it on this service.",
  );
  process.exit(1);
}

let failed = 0;

for (const path of ENDPOINTS) {
  try {
    const res = await fetch(base + path, {
      headers: { "x-cron-secret": secret },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    console.log(`[cron] ${path} -> ${res.status} ${body.slice(0, 500)}`);
    if (!res.ok) failed += 1;
  } catch (error) {
    console.error(`[cron] ${path} -> ${error.message}`);
    failed += 1;
  }
}

process.exit(failed ? 1 : 0);
