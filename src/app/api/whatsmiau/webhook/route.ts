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
// random bytes, generated once per instance row, and the provider
// sends it back on every call — so it identifies the instance exactly.
// The instance name is only a cross-check, and it is the PROVIDER's
// name: the customer picks a name of their own, and the instance
// carries a namespaced one on the provider side
// (`<empresa>_<instancia>`). Two accounts may well pick the same
// customer-side name, which would make a name-only lookup ambiguous.
//
// The provider names the session in more than one place — in the
// envelope AND in `data.instanceId` — and in the Evolution-compatible
// format it spells them with the compatibility alias
// (`<empresa>_<instancia>_<id>`), the same instance under another
// name. `isSameProviderInstance` recognises the alias, and every name
// the payload carries is compared: one match is enough.
// An instance we do not know is a 404.
// ============================================================

import { timingSafeEqual } from 'node:crypto';

import { NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { safeMediaStorage } from '@/lib/media/storage';
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
  normalizeContactUpsert,
  normalizeDeletedMessage,
  normalizeEditedMessage,
  normalizeInboundMessages,
  normalizeStatusUpdate,
} from '@/lib/whatsapp/providers/whatsmiau/normalize';
import { handleWhatsmiauContactUpsert } from '@/lib/whatsapp/providers/whatsmiau/contact-upsert';
import { isSameProviderInstance } from '@/lib/whatsapp/providers/whatsmiau/naming';
import {
  envelopeRecord,
  instanceNames,
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
  // The provider names the instance in more than one place — in the
  // envelope AND in `data.instanceId` — and in the Evolution-compatible
  // format it spells both with the compatibility ALIAS (`<nome>_<id>`)
  // instead of the name we gave it. The secret is the routing key; these
  // names are only a cross-check, so every name the payload carries is
  // compared and one match is enough. A payload that names no instance
  // we know belongs to another one: 404, so the operator knows the
  // instance is not wired here.
  const named = instanceNames(envelope);
  if (!named.some((name) => isSameProviderInstance(config.provider_instance_name, name))) {
    console.warn(
      '[whatsmiau-webhook] the payload names an instance this secret is not bound to:',
      named.join(', ') || '(no instance name at all)',
    );
    return NextResponse.json({ error: 'unknown_instance' }, { status: 404 });
  }

  if (!isSupportedWebhookEvent(envelope.event)) {
    // An event we do not model (`messages.set`, `group-participants.update`, ...).
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

    // The account's storage — Supabase bucket or R2, per `media_settings`.
    // The mirror writes where the composer writes, so an incoming photo
    // and an outgoing one land in the same place. `safeMediaStorage`
    // never throws: a failure here must not cost the whole message.
    const storage = await safeMediaStorage(config.account_id, db);

    const ctx: WhatsmiauInboundContext = {
      db,
      accountId: config.account_id,
      ownerUserId,
      instanceSettings: config.instance_settings,
      storage,
      // The row that owns this connection. The account may hold
      // several, so a status change has to land on THIS one.
      configId: config.id,
      // The namespaced name the instance carries ON THE PROVIDER — it
      // is what goes into the provider's URLs.
      providerInstanceName: config.provider_instance_name,
    };

    switch (envelope.event) {
      case 'messages.upsert': {
        // Until the provider finishes its migration, an EDIT can still
        // arrive as an upsert with `messageType: "editedMessage"`. It
        // is not a new message — it is the new text of a message we
        // already have — so it updates the row instead of inserting a
        // second one.
        const data = envelopeRecord(envelope);
        if (data.messageType === 'editedMessage') {
          const edit = normalizeEditedMessage(data);
          if (!edit) return;
          await handleWhatsmiauEditedMessage(ctx, edit);
          return;
        }
        // The documented shape is a NOTIFY batch (`data.messages`); the
        // Evolution-compatible delivery puts ONE message straight in
        // `data`. Both are read.
        const messages = normalizeInboundMessages(data);
        if (!messages) {
          // Nothing we could read. Log the SHAPE — the KEYS only, never
          // the content — so the next delivery says what to support.
          console.warn(
            '[whatsmiau-webhook] a message arrived without a readable id; data keys:',
            Object.keys(data).join(', '),
          );
          return;
        }
        for (const message of messages) {
          await handleWhatsmiauInboundMessage(ctx, message);
        }
        return;
      }
      case 'messages.update': {
        const update = normalizeStatusUpdate(envelopeRecord(envelope));
        if (!update) return;
        await handleWhatsmiauStatusUpdate(ctx, update);
        return;
      }
      case 'messages.edited': {
        const update = normalizeEditedMessage(envelopeRecord(envelope));
        if (!update) return;
        await handleWhatsmiauEditedMessage(ctx, update);
        return;
      }
      case 'messages.delete': {
        const update = normalizeDeletedMessage(envelopeRecord(envelope));
        if (!update) return;
        await handleWhatsmiauDeletedMessage(ctx, update);
        return;
      }
      case 'connection.update': {
        const update = normalizeConnectionUpdate(envelopeRecord(envelope));
        if (!update) return;
        await handleWhatsmiauConnectionUpdate(ctx, update);
        return;
      }
      case 'contacts.upsert': {
        // The provider pushes the contact's picture url. It is the
        // second chance for a contact whose on-demand lookup failed —
        // and it costs nothing: no call, no key.
        const contacts = normalizeContactUpsert(envelope.data);
        for (const contact of contacts) {
          await handleWhatsmiauContactUpsert(ctx, contact);
        }
        return;
      }
    }
  } catch (error) {
    console.error('[whatsmiau-webhook] processing failed:', error);
  }
}
