/**
 * The types of the "Origem do lead" module.
 *
 * `LeadChannel` and `LeadProvider` mirror the CHECK constraints of
 * the `lead_origins` table (migration 067) — a value outside these
 * unions would abort the insert, so the vocabulary lives in ONE
 * place and the migration is the other.
 */

/** Where the touch happened. */
export type LeadChannel =
  | 'whatsapp'
  | 'instagram_dm'
  | 'instagram_comment'
  | 'tiktok_dm'
  | 'tiktok_lead'
  | 'web'
  | 'direct';

/** Who delivered the touch. */
export type LeadProvider = 'meta' | 'whatsmiau' | 'tiktok' | 'web';

/** A row of `lead_origins`. */
export interface LeadOriginRow {
  id: string;
  account_id: string;
  contact_id: string | null;
  channel: LeadChannel;
  provider: LeadProvider | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_path: string | null;
  referrer: string | null;
  click_ids: Record<string, string>;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  creative_id: string | null;
  post_id: string | null;
  external_id: string | null;
  lead_token: string | null;
  link_code: string | null;
  phone: string | null;
  is_primary: boolean;
  touched_at: string;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** The shape `insertOrigin` writes. */
export type NewLeadOrigin = Omit<
  LeadOriginRow,
  'id' | 'created_at' | 'updated_at'
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

/** A campaign link, as stored in `lead_settings.links`. */
export interface CampaignLink {
  code: string;
  label: string;
  /** `wa:<number>` or `url:<https://...>`. */
  destination: string;
  /** The prefilled WhatsApp message. */
  message: string;
  created_at: string;
}

/** The account's lead configuration. */
export interface LeadSettings {
  account_id: string;
  capture_key: string;
  enabled: boolean;
  allowed_hosts: string[];
  links: CampaignLink[];
}
