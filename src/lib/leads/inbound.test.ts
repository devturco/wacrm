import { describe, expect, it } from 'vitest';
import { referralFromMetaMessage, stripLeadCode } from './inbound';

describe('stripLeadCode', () => {
  it('removes the code and keeps the rest', () => {
    expect(stripLeadCode('Olá ref A7X9K2M4')).toEqual({
      token: 'A7X9K2M4',
      text: 'Olá',
    });
  });

  it('leaves a message without a code alone', () => {
    expect(stripLeadCode('Olá')).toEqual({ token: null, text: 'Olá' });
  });

  it('handles an empty message', () => {
    expect(stripLeadCode(null)).toEqual({ token: null, text: '' });
  });
});

describe('referralFromMetaMessage', () => {
  it('reads the click-to-WhatsApp referral', () => {
    const facts = referralFromMetaMessage({
      referral: {
        source: 'facebook',
        ad_id: 'ad-1',
        adset_id: 'adset-1',
        campaign_id: 'camp-1',
      },
    });
    expect(facts?.ad_id).toBe('ad-1');
    expect(facts?.campaign_id).toBe('camp-1');
    expect(facts?.source).toBe('facebook');
  });

  it('reads the messaging referral of a DM that answers an ad', () => {
    const facts = referralFromMetaMessage({
      context: {
        messaging_referral: {
          ad_id: 'ad-2',
          post_id: 'post-2',
          ads_metadata: { ad_campaign_id: 123 },
        },
      },
    });
    expect(facts?.post_id).toBe('post-2');
    expect(facts?.ads_metadata).toEqual({ ad_campaign_id: 123 });
  });

  it('returns null when there is no referral', () => {
    expect(referralFromMetaMessage({})).toBeNull();
  });

  it('returns null when the referral carries no ad id', () => {
    expect(
      referralFromMetaMessage({ referral: { source: 'facebook' } })
    ).toBeNull();
  });
});
