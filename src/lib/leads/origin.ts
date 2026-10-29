/**
 * Tying a lead's first touch to the contact it became.
 *
 * The module is PURE with respect to HTTP: it takes a store and
 * returns what it did. Both inbound paths — the Meta webhook and
 * the whatsmiau provider — call the SAME function, so the two
 * providers behave identically.
 *
 * The resolution order (spec §6.1):
 *
 *   1. the code in the message  (`ref A7X9K2M4`)
 *   2. the phone (a pending origin captured from the site form)
 *   3. the referral the provider delivered
 *   4. `direct` — nothing above
 */

import { isDifferentTouch, type TouchFacts } from './utm';
import type {
  LeadChannel,
  LeadOriginRow,
  LeadProvider,
  NewLeadOrigin,
} from './types';
import { generateLeadToken } from './token';

/** How long a pending origin can wait for its contact. */
export const PHONE_MATCH_WINDOW_DAYS = 30;

/** What the provider told us about the ad the lead came from. */
export interface ReferralFacts {
  ad_id?: string | null;
  adset_id?: string | null;
  campaign_id?: string | null;
  creative_id?: string | null;
  post_id?: string | null;
  /** The provider's own source name (`facebook`, `instagram`...). */
  source?: string | null;
  ads_metadata?: Record<string, unknown> | null;
}

/**
 * The persistence the resolver needs.
 *
 * Narrow on purpose: the resolver must be testable without a
 * database, and the SQL must live in one place (`store.ts`).
 */
export interface LeadOriginStore {
  /** A pending origin with this token. */
  findByToken(accountId: string, token: string): Promise<LeadOriginRow | null>;
  /** The most recent pending origin with this phone. */
  findPendingByPhone(
    accountId: string,
    phone: string,
    sinceIso: string
  ): Promise<LeadOriginRow | null>;
  /** The contact's primary origin. */
  findPrimaryByContact(
    accountId: string,
    contactId: string
  ): Promise<LeadOriginRow | null>;
  insertOrigin(input: NewLeadOrigin): Promise<LeadOriginRow | null>;
  attachContact(originId: string, contactId: string): Promise<void>;
  setPrimary(originId: string): Promise<boolean>;
  isTokenTaken(accountId: string, token: string): Promise<boolean>;
}

/** How the origin was found. */
export type OriginMatch = 'token' | 'phone' | 'referral' | 'direct' | 'existing';

export interface ResolveOriginInput {
  accountId: string;
  contactId: string;
  provider: LeadProvider;
  channel?: LeadChannel;
  phone?: string | null;
  leadToken?: string | null;
  /** The text as the customer sent it, code included. */
  rawText?: string | null;
  referral?: ReferralFacts | null;
  /** The moment of the touch. */
  touchedAt?: string;
}

export interface ResolveOriginResult {
  origin: LeadOriginRow | null;
  matchedBy: OriginMatch;
}

function nowIso(): string {
  return new Date().toISOString();
}

function referralFacts(referral: ReferralFacts | null | undefined): TouchFacts {
  return {
    campaign_id: referral?.campaign_id ?? null,
    post_id: referral?.post_id ?? null,
  };
}

/**
 * Bind a pending origin to a contact.
 *
 * The contact is attached FIRST and the primary flag is set after,
 * because the partial unique index only covers the rows that have a
 * contact. When the contact already has a primary origin, the
 * pending row joins the journey as a second touch — the primary is
 * NOT touched (spec §6.2).
 */
async function attach(
  store: LeadOriginStore,
  origin: LeadOriginRow,
  accountId: string,
  contactId: string
): Promise<void> {
  await store.attachContact(origin.id, contactId);

  const primary = await store.findPrimaryByContact(accountId, contactId);
  if (primary) return;

  // The contact had no origin: this one becomes the primary. A
  // concurrent inbound for the same contact can win the race — the
  // unique index rejects the loser, which is the right answer.
  await store.setPrimary(origin.id);
}

/**
 * Resolve — and record — where a lead came from.
 */
export async function resolveOrigin(
  store: LeadOriginStore,
  input: ResolveOriginInput
): Promise<ResolveOriginResult> {
  const { accountId, contactId } = input;
  const touchedAt = input.touchedAt ?? nowIso();
  const provider = input.provider;
  const channel: LeadChannel = input.channel ?? 'whatsapp';

  // 1. The code in the message.
  const token = input.leadToken?.trim();
  if (token) {
    const pending = await store.findByToken(accountId, token);
    if (pending) {
      await attach(store, pending, accountId, contactId);
      return { origin: pending, matchedBy: 'token' };
    }
  }

  // 2. The phone — the pending origin captured from the site form.
  const phone = input.phone?.trim();
  if (phone) {
    const since = new Date(
      Date.now() - PHONE_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const pending = await store.findPendingByPhone(accountId, phone, since);
    if (pending) {
      await attach(store, pending, accountId, contactId);
      return { origin: pending, matchedBy: 'phone' };
    }
  }

  const primary = await store.findPrimaryByContact(accountId, contactId);

  // 3 and 4. A referral or a direct touch. Neither creates a new row
  // when the touch repeats what the primary already says (spec §6.2).
  const referral = input.referral ?? null;
  const hasReferral = Boolean(
    referral &&
      (referral.ad_id ||
        referral.adset_id ||
        referral.campaign_id ||
        referral.creative_id ||
        referral.post_id)
  );

  if (
    primary &&
    !isDifferentTouch(referralFacts(primary), referralFacts(referral))
  ) {
    return { origin: primary, matchedBy: 'existing' };
  }

  const meta: Record<string, unknown> = {};
  if (input.rawText) meta.raw_text = input.rawText;
  if (referral?.source) meta.referral_source = referral.source;
  if (referral?.ads_metadata) meta.ads_metadata = referral.ads_metadata;

  const created = await store.insertOrigin({
    account_id: accountId,
    contact_id: contactId,
    channel: hasReferral ? channel : 'direct',
    provider,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    landing_path: null,
    referrer: null,
    click_ids: {},
    ad_id: referral?.ad_id ?? null,
    adset_id: referral?.adset_id ?? null,
    campaign_id: referral?.campaign_id ?? null,
    creative_id: referral?.creative_id ?? null,
    post_id: referral?.post_id ?? null,
    external_id: null,
    lead_token: null,
    link_code: null,
    phone: phone ?? null,
    is_primary: !primary,
    touched_at: touchedAt,
    meta,
  });

  return {
    origin: created,
    matchedBy: hasReferral ? 'referral' : 'direct',
  };
}

/**
 * A code that is not taken yet.
 *
 * 40 bits is a lot of room, but a collision inside one account would
 * tie two leads to the same origin — so we check and regenerate.
 *
 * `generate` is injectable so the test can hand out a known sequence
 * of codes; in production it draws from the alphabet.
 */
export async function generateUniqueLeadToken(
  store: LeadOriginStore,
  accountId: string,
  maxAttempts = 5,
  generate: () => string = () => generateLeadToken()
): Promise<string> {
  let token = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    token = generate();
    const taken = await store.isTokenTaken(accountId, token);
    if (!taken) return token;
  }
  // Every attempt collided: the last code is returned and the unique
  // index on the table rejects it — the collision surfaces in the
  // database instead of silently tying two leads to one origin.
  return token;
}
