// ============================================================
// The WhatsMiau (API CRMBR) inbound webhook.
//
// This is a route of its own — the Meta webhook keeps its own URL, its
// own signature scheme and its own payload shape. Nothing here is
// shared with `src/app/api/whatsapp/webhook/route.ts`, and nothing
// there is touched by this file.
//
// Authentication: the provider sends ONLY the headers WE configured in
// the instance's `webhook.headers` — the WhatsMiau documentation is
// explicit that `x-tenant-secret` (or any other name) is defined by
// the caller, not guaranteed by the service. We define
// `Authorization: Bearer <secret>`, and the secret is the one stored
// on the account's `whatsmiau_config` row.
//
// Account routing: the webhook secret is the routing key. It is 32
// random bytes, generated once per account row, and the provider
// sends it back on every call — so it identifies the account exactly.
// The instance name in the envelope is only a cross-check: the
// customer picks that name, and two accounts may well pick the same
// one, which would make a name-only lookup ambiguous.
// An instance we do not know is a 404.
// ============================================================

import { timingSafeEqual } from 'node:crypto';

import { NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  MAX_WEBHOOK_BODY_BYTES,
  readCappedBody,
} from '@/lib/whatsapp/webhook-body';
import {
  loadWhatsmiauConfigByWebhookSecret,
  type WhatsmiauConfigRow,
} from '@/lib/whatsapp/whatsmiau-config';
import {
  handleWhatsmiauConnectionUpdate,
  handleWhatsmiauDeletedMessage,
  handleWhatsmiauEditedMessage,
  handleWhatsmiauInboundMessage,
  handleWhatsmiauStatusUpdate,
  resolveWhatsmiauOwnerUserId,
  type WhatsmiauInboundContext,
} from '@/lib/whatsapp/providers/whatsmiau/inbound';
import {
  normalizeConnectionUpdate,
  normalizeDeletedMessage,
  normalizeEditedMessage,
  normalizeInboundMessage,
  normalizeStatusUpdate,
} from '@/lib/whatsapp/providers/whatsmiau/normalize';
import {
  isSupportedWebhookEvent,
  parseWhatsmiauWebhook,
  type WhatsmiauWebhookEnvelope,
} from '@/lib/whatsapp/providers/whatsmiau/webhook';

// Inbound processing fans out to contact/conversation writes, media
// mirroring, flows, automations and the AI — give it headroom, the
// same way the Meta webhook does.
export const maxDuration = 60;

/**
 * Constant-time comparison of two strings. A webhook secret checked
 * with `===` leaks its bytes through timing.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Health check — is this deployment able to receive CRMBR events? */
export async function GET() {
  return NextResponse.json(
    { status: 'ok', provider: 'whatsmiau' },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  // The provider documents a 4 MB limit on the webhook body; we cap at
  // the same number so an oversized delivery is refused instead of
  // buffered.
  const raw = await readCappedBody(request, MAX_WEBHOOK_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const envelope = parseWhatsmiauWebhook(payload);
  if (!envelope) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const db = supabaseAdmin();

  // The account behind the instance. The webhook secret is the
  // routing key: it is unique per account, so it identifies the owner
  // even when two accounts named their instance the same way.
  const presented = request.headers.get('authorization') ?? '';
  const secret = presented.startsWith('Bearer ')
    ? presented.slice('Bearer '.length).trim()
    : '';
  if (!secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const config = await loadWhatsmiauConfigByWebhookSecret(db, secret);
  if (!config || !safeEqual(config.webhook_secret, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // The envelope must belong to the instance the secret is bound to.
  // An instance we do not know is a 404: the operator needs to know
  // the instance is not wired here.
  if (config.instance_name !== envelope.instance) {
    return NextResponse.json({ error: 'unknown_instance' }, { status: 404 });
  }

  if (!isSupportedWebhookEvent(envelope.event)) {
    // An event we do not model (`contacts.upsert`, `messages.set`, ...).
    // Acknowledge it: retrying would never make it supported.
    return NextResponse.json(
      { status: 'ignored', event: envelope.event },
      { status: 200 },
    );
  }

  // The work runs inside `after()` so the provider gets its 200 right
  // away while the promise stays alive long enough for the database
  // writes to finish. A floating promise here can be frozen half-done
  // on Vercel (issue #301) — the same failure the Meta webhook hit.
  after(async () => {
    await processWhatsmiauEvent(db, config, envelope);
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

/**
 * Route one event to the handler that owns it. Every failure is logged
 * and swallowed: the provider already got its 200, and a throw here
 * would only produce a confusing unhandled rejection.
 */
async function processWhatsmiauEvent(
  db: SupabaseClient,
  config: WhatsmiauConfigRow,
  envelope: WhatsmiauWebhookEnvelope,
): Promise<void> {
  try {
    const ownerUserId = await resolveWhatsmiauOwnerUserId(db, config.account_id);

    const ctx: WhatsmiauInboundContext = {
      db,
      accountId: config.account_id,
      ownerUserId,
      instanceSettings: config.instance_settings,
      storage: db.storage,
    };

    switch (envelope.event) {
      case 'messages.upsert': {
        const message = normalizeInboundMessage(envelope.data);
        if (!message) return;
        await handleWhatsmiauInboundMessage(ctx, message);
        return;
      }
      case 'messages.update': {
        const update = normalizeStatusUpdate(envelope.data);
        if (!update) return;
        await handleWhatsmiauStatusUpdate(ctx, update);
        return;
      }
      case 'messages.edited': {
        const update = normalizeEditedMessage(envelope.data);
        if (!update) return;
        await handleWhatsmiauEditedMessage(ctx, update);
        return;
      }
      case 'messages.delete': {
        const update = normalizeDeletedMessage(envelope.data);
        if (!update) return;
        await handleWhatsmiauDeletedMessage(ctx, update);
        return;
      }
      case 'connection.update': {
        const update = normalizeConnectionUpdate(envelope.data);
        if (!update) return;
        await handleWhatsmiauConnectionUpdate(ctx, update);
        return;
      }
    }
  } catch (error) {
    console.error('[whatsmiau-webhook] processing failed:', error);
  }
}
