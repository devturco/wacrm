/**
 * The glue between the inbound pipelines and the lead module.
 *
 * Two providers, one behaviour: the Meta webhook and the whatsmiau
 * provider both call `resolveOrigin` with the same shape.
 */

import type { ReferralFacts } from './origin';
import { extractLeadToken } from './token';

/**
 * The message text, without the lead code.
 *
 * The agent reads the clean text; the raw text goes into
 * `lead_origins.meta.raw_text`.
 */
export function stripLeadCode(text: string | null | undefined): {
  token: string | null;
  text: string;
} {
  const raw = text ?? '';
  const extracted = extractLeadToken(raw);
  if (!extracted) return { token: null, text: raw };
  return { token: extracted.token, text: extracted.text };
}

/**
 * The ad a Meta message came from.
 *
 * Two envelopes carry it (spec §6.3):
 *
 *   - `referral` — click-to-WhatsApp ads: `ad_id`, `adset_id`,
 *     `campaign_id`, `source`.
 *   - `context.messaging_referral` — a DM that answers an ad: the
 *     same ids plus `post_id` and `ads_metadata`.
 *
 * Today NEITHER is read anywhere in the app — the referral of an ad
 * is exactly the origin the CRM was missing.
 */
export function referralFromMetaMessage(message: {
  referral?: Record<string, unknown> | null;
  context?: { messaging_referral?: Record<string, unknown> | null } | null;
}): ReferralFacts | null {
  const referral =
    message.referral ?? message.context?.messaging_referral ?? null;
  if (!referral) return null;

  const facts: ReferralFacts = {
    ad_id: readString(referral.ad_id),
    adset_id: readString(referral.adset_id),
    campaign_id: readString(referral.campaign_id),
    creative_id: readString(referral.creative_id ?? referral.adcreatives_id),
    post_id: readString(referral.post_id),
    source: readString(referral.source),
    ads_metadata: isRecord(referral.ads_metadata)
      ? referral.ads_metadata
      : null,
  };

  const hasAny = Boolean(
    facts.ad_id ||
      facts.adset_id ||
      facts.campaign_id ||
      facts.creative_id ||
      facts.post_id
  );
  return hasAny ? facts : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
