// ============================================================
// The public capture endpoint.
//
// The client pastes the track script on their own site; the script
// POSTs the origin here. There is NO session — the request
// authenticates with the capture key, a PUBLIC identifier that only
// says which account the origin belongs to.
//
// Nothing here creates a contact. The origin is written PENDING
// (contact_id NULL) and the contact is born when the lead actually
// talks to us (the inbound). Zero spam, zero ghost contacts.
// ============================================================

import { NextResponse } from 'next/server';

import { getT } from '@/lib/i18n/translate';
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from '@/lib/rate-limit';
import { normalizePhone, parseInternationalPhone } from '@/lib/whatsapp/phone-utils';

import { supabaseAdmin } from '@/lib/leads/admin-client';
import { generateUniqueLeadToken } from '@/lib/leads/origin';
import {
  createLeadOriginStore,
  createLeadSettingsStore,
} from '@/lib/leads/store';
import {
  isDifferentTouch,
  isEmptyTouch,
  normalizeTouch,
  type TouchPayload,
} from '@/lib/leads/utm';

const t = getT('Api');

const ACTIONS = ['form_submit', 'link_click', 'page_view'] as const;
const CHANNELS = ['web', 'whatsapp', 'instagram_dm', 'tiktok_dm'] as const;

type CaptureAction = (typeof ACTIONS)[number];
type CaptureChannel = (typeof CHANNELS)[number];

interface CaptureBody {
  action: CaptureAction;
  channel: CaptureChannel;
  phone: string | null;
  name: string | null;
  email: string | null;
  first: TouchPayload;
  now: TouchPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * The phone, as the inbound stores it: digits only.
 *
 * A number typed by a person only becomes reliable with the
 * international `+` — without it, "1199999999" could be Brazil or
 * Uruguay. So the strict parser is tried first and the digits-only
 * fallback is the last resort.
 */
function normalizeCapturedPhone(raw: string | null): string | null {
  if (!raw) return null;
  const strict = parseInternationalPhone(raw);
  if (strict) return strict;
  const loose = normalizePhone(raw);
  return loose || null;
}

/** The host of the request, from `Origin` or from `Referer`. */
function requestHost(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

/** Is this host allowed? An empty allowlist accepts everything. */
function hostAllowed(host: string | null, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return true;
  if (!host) return false;
  return allowedHosts.some((allowed) => allowed.toLowerCase() === host);
}

/** Validate the untrusted body. */
function parseBody(
  raw: unknown
): { ok: true; body: CaptureBody } | { ok: false; fields: string[] } {
  const fields: string[] = [];
  if (!isRecord(raw)) return { ok: false, fields: ['body'] };

  const action = raw.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action as CaptureAction)) {
    fields.push('action');
  }
  const channel = raw.channel;
  if (
    typeof channel !== 'string' ||
    !CHANNELS.includes(channel as CaptureChannel)
  ) {
    fields.push('channel');
  }
  if (fields.length > 0) return { ok: false, fields };

  return {
    ok: true,
    body: {
      action: action as CaptureAction,
      channel: channel as CaptureChannel,
      phone: readString(raw.phone, 32),
      name: readString(raw.name, 200),
      email: readString(raw.email, 200),
      first: normalizeTouch(raw.first),
      now: normalizeTouch(raw.now),
    },
  };
}

/**
 * The rows to write.
 *
 * The FIRST touch always gets a row. The "now" row only when it
 * brings something the first one did not (spec §5.2).
 */
export function buildCaptureRows(
  first: TouchPayload,
  now: TouchPayload
): TouchPayload[] {
  if (isEmptyTouch(first)) return [now];
  if (isEmptyTouch(now)) return [first];
  if (!isDifferentTouch(first, now)) return [first];
  return [first, now];
}

export async function POST(request: Request) {
  try {
    const captureKey = request.headers.get('x-capture-key')?.trim();
    if (!captureKey) {
      return NextResponse.json({ error: t('leads.notFound') }, { status: 404 });
    }

    // The IP limit comes FIRST: a bad key must not be able to
    // brute-force the account space.
    const ipLimit = checkRateLimit(
      `lead-capture:ip:${getClientIp(request)}`,
      RATE_LIMITS.leadCapture
    );
    if (!ipLimit.success) return rateLimitResponse(ipLimit);

    const db = supabaseAdmin();
    const settingsStore = createLeadSettingsStore(db);
    const settings = await settingsStore.findByCaptureKey(captureKey);

    // Unknown key OR disabled capture: the SAME answer. The endpoint
    // must not reveal that an account exists.
    if (!settings || !settings.enabled) {
      return NextResponse.json({ error: t('leads.notFound') }, { status: 404 });
    }

    const keyLimit = checkRateLimit(
      `lead-capture:key:${captureKey}`,
      RATE_LIMITS.leadCapture
    );
    if (!keyLimit.success) return rateLimitResponse(keyLimit);

    const host = requestHost(request);
    if (!hostAllowed(host, settings.allowed_hosts)) {
      return NextResponse.json(
        { error: t('leads.hostNotAllowed') },
        { status: 403 }
      );
    }

    const raw = await request.json().catch(() => null);
    const parsed = parseBody(raw);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: t('leads.invalidPayload'), fields: parsed.fields },
        { status: 400 }
      );
    }

    const body = parsed.body;
    const phone = normalizeCapturedPhone(body.phone);
    const rows = buildCaptureRows(body.first, body.now);

    const store = createLeadOriginStore(db);
    const leadToken = await generateUniqueLeadToken(store, settings.account_id);

    for (const [index, row] of rows.entries()) {
      await store.insertOrigin({
        account_id: settings.account_id,
        contact_id: null,
        channel: body.channel,
        provider: 'web',
        utm_source: row.utm_source,
        utm_medium: row.utm_medium,
        utm_campaign: row.utm_campaign,
        utm_content: row.utm_content,
        utm_term: row.utm_term,
        landing_path: row.landing_path,
        referrer: row.referrer,
        click_ids: row.click_ids,
        ad_id: null,
        adset_id: null,
        campaign_id: null,
        creative_id: null,
        post_id: null,
        external_id: null,
        // The token rides on the FIRST touch: the origin of a lead is
        // its first touch (spec D2), and the token is the only bridge
        // between the click and the message.
        lead_token: index === 0 ? leadToken : null,
        link_code: null,
        phone,
        is_primary: false,
        touched_at: new Date().toISOString(),
        meta: { action: body.action, name: body.name, email: body.email },
      });
    }

    return NextResponse.json({ leadToken });
  } catch (err) {
    console.error('[leads/capture] could not record the origin:', err);
    return NextResponse.json(
      { error: t('leads.captureFailed') },
      { status: 500 }
    );
  }
}
