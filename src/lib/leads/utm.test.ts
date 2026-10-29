import { describe, expect, it } from 'vitest';
import {
  CLICK_ID_KEYS,
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_COOKIE_MAX_AGE_DAYS,
  UTM_KEYS,
  decodeFirstTouch,
  emptyTouch,
  encodeFirstTouch,
  isDifferentTouch,
  isEmptyTouch,
  normalizeTouch,
  parseTouch,
} from './utm';

describe('parseTouch', () => {
  it('reads the utm parameters', () => {
    const touch = parseTouch(
      '?utm_source=instagram&utm_medium=paid_social&utm_campaign=verao&utm_content=video1&utm_term=tenha'
    );
    expect(touch.utm_source).toBe('instagram');
    expect(touch.utm_medium).toBe('paid_social');
    expect(touch.utm_campaign).toBe('verao');
    expect(touch.utm_content).toBe('video1');
    expect(touch.utm_term).toBe('tenha');
  });

  it('reads the click ids', () => {
    const touch = parseTouch('?gclid=abc&fbclid=def&ttclid=ghi&wbraid=jkl&igshid=mno');
    expect(touch.click_ids).toEqual({
      gclid: 'abc',
      fbclid: 'def',
      ttclid: 'ghi',
      wbraid: 'jkl',
      igshid: 'mno',
    });
  });

  it('ignores an unknown click id', () => {
    expect(parseTouch('?evil=1').click_ids).toEqual({});
  });

  it('returns nulls for a query without parameters', () => {
    const touch = parseTouch('');
    expect(touch.utm_source).toBeNull();
    expect(isEmptyTouch(touch)).toBe(true);
  });
});

describe('normalizeTouch', () => {
  it('ignores a value that is not a string', () => {
    const touch = normalizeTouch({ utm_source: 42, utm_campaign: ['x'] });
    expect(touch.utm_source).toBeNull();
    expect(touch.utm_campaign).toBeNull();
  });

  it('keeps only the known click ids', () => {
    const touch = normalizeTouch({ click_ids: { gclid: 'abc', nope: 'x' } });
    expect(touch.click_ids).toEqual({ gclid: 'abc' });
  });

  it('survives a payload that is not an object', () => {
    expect(normalizeTouch(null)).toEqual(emptyTouch());
    expect(normalizeTouch('nope')).toEqual(emptyTouch());
  });
});

describe('isDifferentTouch', () => {
  it('is false for two identical touches', () => {
    const a = { utm_source: 'instagram', utm_campaign: 'verao' };
    const b = { utm_source: 'instagram', utm_campaign: 'verao' };
    expect(isDifferentTouch(a, b)).toBe(false);
  });

  it('is true when the campaign changes', () => {
    const a = { utm_campaign: 'verao' };
    const b = { utm_campaign: 'inverno' };
    expect(isDifferentTouch(a, b)).toBe(true);
  });

  it('is true when the campaign appears', () => {
    expect(isDifferentTouch({ utm_campaign: null }, { utm_campaign: 'verao' })).toBe(
      true
    );
  });

  it('compares case-insensitively', () => {
    expect(isDifferentTouch({ utm_campaign: 'VERAO' }, { utm_campaign: 'verao' })).toBe(
      false
    );
  });

  it('looks at the campaign id and the post id, not only at the utm', () => {
    expect(isDifferentTouch({ campaign_id: 'c1' }, { campaign_id: 'c2' })).toBe(true);
    expect(isDifferentTouch({ post_id: 'p1' }, { post_id: 'p2' })).toBe(true);
    expect(isDifferentTouch({ link_code: 'a1' }, { link_code: 'a2' })).toBe(true);
  });
});

describe('the first-touch cookie', () => {
  it('is named crmbr_oid and lives for 30 days', () => {
    expect(FIRST_TOUCH_COOKIE).toBe('crmbr_oid');
    expect(FIRST_TOUCH_COOKIE_MAX_AGE_DAYS).toBe(30);
  });

  it('round-trips through the encoding', () => {
    const payload = {
      ...emptyTouch(),
      utm_source: 'instagram',
      utm_campaign: 'verão',
      link_code: 'a7x9k2m4',
      lead_token: 'A7X9K2M4',
      touched_at: '2026-10-29T12:00:00.000Z',
    };
    expect(decodeFirstTouch(encodeFirstTouch(payload))).toEqual(payload);
  });

  it('decodes an empty cookie into an empty payload', () => {
    const decoded = decodeFirstTouch('');
    expect(decoded.utm_source).toBeNull();
    expect(decoded.click_ids).toEqual({});
  });
});

describe('the key lists', () => {
  it('covers the five utm parameters', () => {
    expect([...UTM_KEYS]).toEqual([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
    ]);
  });

  it('covers the five click ids', () => {
    expect([...CLICK_ID_KEYS]).toEqual([
      'gclid',
      'fbclid',
      'ttclid',
      'wbraid',
      'igshid',
    ]);
  });
});
