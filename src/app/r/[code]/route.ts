// ============================================================
// The campaign link.
//
// The link that goes into the ad: `/r/a7x9k2m4?utm_source=...`.
//
// Every click is a touch: a pending origin is written, a fresh
// 8-character code is minted for THAT click, and the code is
// appended to the prefilled WhatsApp message. The code is what ties
// the click to the first inbound message — cookies do not cross the
// boundary between the browser and WhatsApp.
//
// The cookie is written too, but only when it is not there yet: the
// FIRST touch wins.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/leads/admin-client';
import { generateUniqueLeadToken } from '@/lib/leads/origin';
import {
  createLeadOriginStore,
  createLeadSettingsStore,
} from '@/lib/leads/store';
import {
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_COOKIE_MAX_AGE_DAYS,
  encodeFirstTouch,
  parseTouch,
  type FirstTouchPayload,
} from '@/lib/leads/utm';
import type { CampaignLink } from '@/lib/leads/types';

/** A campaign code: lowercase letters and digits. */
function normalizeCode(raw: string): string | null {
  const code = raw.trim().toLowerCase();
  if (!/^[a-z0-9]{4,32}$/.test(code)) return null;
  return code;
}

/** Where a `wa:` link goes. */
function whatsappUrl(
  destination: string,
  message: string,
  token: string
): string | null {
  const number = destination.slice(3).replace(/\D/g, '');
  if (!number) return null;
  const text = `${message} ref ${token}`.trim();
  // URLSearchParams encodes the space as "+", which is what wa.me
  // expects for a prefilled message.
  const params = new URLSearchParams();
  params.set('text', text);
  return `https://wa.me/${number}?${params.toString()}`;
}

/** Where a `url:` link goes, with the utm parameters kept. */
function urlDestination(destination: string, search: string): string | null {
  const raw = destination.slice(4).trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const params = new URLSearchParams(search);
  for (const key of [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
  ]) {
    const value = params.get(key);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = normalizeCode(rawCode);
  if (!code) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const db = supabaseAdmin();
  const settingsStore = createLeadSettingsStore(db);
  const settings = await settingsStore.findByLinkCode(code);
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const link = (settings.links as CampaignLink[]).find(
    (candidate) => candidate.code === code
  );
  if (!link) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const touch = parseTouch(url.search);
  const touchedAt = new Date().toISOString();

  const store = createLeadOriginStore(db);
  const leadToken = await generateUniqueLeadToken(store, settings.account_id);

  await store.insertOrigin({
    account_id: settings.account_id,
    contact_id: null,
    channel: 'web',
    provider: 'web',
    utm_source: touch.utm_source,
    utm_medium: touch.utm_medium,
    utm_campaign: touch.utm_campaign,
    utm_content: touch.utm_content,
    utm_term: touch.utm_term,
    landing_path: `/r/${code}`,
    referrer: request.headers.get('referer'),
    click_ids: touch.click_ids,
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    creative_id: null,
    post_id: null,
    external_id: null,
    lead_token: leadToken,
    link_code: code,
    phone: null,
    is_primary: false,
    touched_at: touchedAt,
    meta: { label: link.label, destination: link.destination },
  });

  const destination = link.destination.startsWith('wa:')
    ? whatsappUrl(link.destination, link.message ?? '', leadToken)
    : link.destination.startsWith('url:')
      ? urlDestination(link.destination, url.search)
      : null;

  if (!destination) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const cookie: FirstTouchPayload = {
    ...touch,
    link_code: code,
    lead_token: leadToken,
    touched_at: touchedAt,
  };

  const response = NextResponse.redirect(destination, 302);
  response.cookies.set({
    name: FIRST_TOUCH_COOKIE,
    value: encodeFirstTouch(cookie),
    maxAge: FIRST_TOUCH_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
  });
  return response;
}
