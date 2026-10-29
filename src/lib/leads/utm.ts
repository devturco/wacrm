/**
 * The web axis of a touch: the UTM parameters, the click ids, the
 * landing page and the referrer.
 *
 * Everything here is PURE — the same functions run in the capture
 * route, in the `/r/<code>` route and in the browser script, so the
 * first-touch cookie is written and read with the same format.
 */

/** The first-party cookie that remembers the first touch. */
export const FIRST_TOUCH_COOKIE = 'crmbr_oid';

/** How long the first touch is remembered. */
export const FIRST_TOUCH_COOKIE_MAX_AGE_DAYS = 30;

/** The five standard UTM parameters. */
export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

/** The click ids we keep. */
export const CLICK_ID_KEYS = [
  'gclid',
  'fbclid',
  'ttclid',
  'wbraid',
  'igshid',
] as const;

/** The web facts of a touch. */
export interface TouchPayload {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_path: string | null;
  referrer: string | null;
  click_ids: Record<string, string>;
}

/** The touch, plus what the capture route adds to it. */
export interface FirstTouchPayload extends TouchPayload {
  link_code: string | null;
  lead_token: string | null;
  touched_at: string;
}

/** A touch with nothing on it. */
export function emptyTouch(): TouchPayload {
  return {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    landing_path: null,
    referrer: null,
    click_ids: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string, trimmed and capped. Anything else is null. */
function readString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** Only the click ids we know about. */
function readClickIds(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const key of CLICK_ID_KEYS) {
    const read = readString(value[key], 255);
    if (read) out[key] = read;
  }
  return out;
}

/**
 * A touch from an untrusted payload.
 *
 * The public endpoint receives JSON from the browser, so every field
 * is checked: a number in `utm_source` is not a string and is
 * dropped, an unknown click id is not stored, and a long value is
 * capped.
 */
export function normalizeTouch(value: unknown): TouchPayload {
  if (!isRecord(value)) return emptyTouch();

  return {
    utm_source: readString(value.utm_source),
    utm_medium: readString(value.utm_medium),
    utm_campaign: readString(value.utm_campaign),
    utm_content: readString(value.utm_content),
    utm_term: readString(value.utm_term),
    landing_path: readString(value.landing_path),
    referrer: readString(value.referrer),
    click_ids: readClickIds(value.click_ids),
  };
}

/** A touch from a query string. */
export function parseTouch(search: string): TouchPayload {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );

  const touch = emptyTouch();
  for (const key of UTM_KEYS) {
    const read = readString(params.get(key));
    if (read) touch[key] = read;
  }
  const clickIds: Record<string, string> = {};
  for (const key of CLICK_ID_KEYS) {
    const read = readString(params.get(key), 255);
    if (read) clickIds[key] = read;
  }
  touch.click_ids = clickIds;
  return touch;
}

/** Is there nothing on this touch? */
export function isEmptyTouch(touch: TouchPayload): boolean {
  return (
    !touch.utm_source &&
    !touch.utm_medium &&
    !touch.utm_campaign &&
    !touch.utm_content &&
    !touch.utm_term &&
    !touch.landing_path &&
    !touch.referrer &&
    Object.keys(touch.click_ids).length === 0
  );
}

/**
 * The fields that decide whether two touches are the same touch.
 *
 * The union of the two lists in the spec: the capture endpoint
 * compares `utm_source` / `utm_campaign` / `utm_content` /
 * `link_code`, and the inbound compares `campaign_id` / `post_id` /
 * `utm_campaign` / `link_code`. At capture time there is no
 * `campaign_id` nor `post_id` (those are the social axis), so the
 * union never fires where the spec would not.
 */
export const DIFF_TOUCH_FIELDS = [
  'utm_source',
  'utm_campaign',
  'utm_content',
  'campaign_id',
  'post_id',
  'link_code',
] as const;

/** The facts two touches are compared by. */
export interface TouchFacts {
  utm_source?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  campaign_id?: string | null;
  post_id?: string | null;
  link_code?: string | null;
}

function normalizeFact(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Do these two touches bring something different? */
export function isDifferentTouch(a: TouchFacts, b: TouchFacts): boolean {
  return DIFF_TOUCH_FIELDS.some(
    (field) => normalizeFact(a[field]) !== normalizeFact(b[field])
  );
}

/**
 * The cookie value.
 *
 * A plain query string, not JSON: the browser decodes it with
 * `URLSearchParams` and the server encodes it with the same class.
 * No base64, no UTF-8 dance, nothing to keep in sync.
 */
export function encodeFirstTouch(payload: FirstTouchPayload): string {
  const params = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = payload[key];
    if (value) params.set(key, value);
  }
  if (payload.landing_path) params.set('landing_path', payload.landing_path);
  if (payload.referrer) params.set('referrer', payload.referrer);
  for (const key of CLICK_ID_KEYS) {
    const value = payload.click_ids[key];
    if (value) params.set(key, value);
  }
  if (payload.link_code) params.set('link_code', payload.link_code);
  if (payload.lead_token) params.set('lead_token', payload.lead_token);
  if (payload.touched_at) params.set('touched_at', payload.touched_at);
  return params.toString();
}

/** The cookie value, back into a payload. */
export function decodeFirstTouch(value: string): FirstTouchPayload {
  const params = new URLSearchParams(value);
  const touch = normalizeTouch({
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_content: params.get('utm_content'),
    utm_term: params.get('utm_term'),
    landing_path: params.get('landing_path'),
    referrer: params.get('referrer'),
    click_ids: {
      gclid: params.get('gclid'),
      fbclid: params.get('fbclid'),
      ttclid: params.get('ttclid'),
      wbraid: params.get('wbraid'),
      igshid: params.get('igshid'),
    },
  });

  return {
    ...touch,
    link_code: readString(params.get('link_code')),
    lead_token: readString(params.get('lead_token')),
    touched_at: readString(params.get('touched_at')) ?? new Date(0).toISOString(),
  };
}
