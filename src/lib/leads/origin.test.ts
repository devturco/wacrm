import { describe, expect, it } from 'vitest';
import {
  PHONE_MATCH_WINDOW_DAYS,
  generateUniqueLeadToken,
  resolveOrigin,
  type LeadOriginStore,
} from './origin';
import type { LeadOriginRow, NewLeadOrigin } from './types';

/**
 * The clock of the test, so the 30-day window does not depend on the
 * day the suite runs.
 */
const NOW_ISO = new Date().toISOString();

/** Far enough in the past to be outside any window. */
const LONG_AGO_ISO = '2020-01-01T00:00:00.000Z';

function makeRow(overrides: Partial<LeadOriginRow> = {}): LeadOriginRow {
  return {
    id: 'origin-1',
    account_id: 'acc-1',
    contact_id: null,
    channel: 'web',
    provider: 'web',
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    landing_path: null,
    referrer: null,
    click_ids: {},
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    creative_id: null,
    post_id: null,
    external_id: null,
    lead_token: null,
    link_code: null,
    phone: null,
    is_primary: false,
    touched_at: NOW_ISO,
    meta: {},
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

/** A store that remembers everything it was asked to remember. */
function makeStore(rows: LeadOriginRow[] = []) {
  const state = { rows: [...rows] };
  const store: LeadOriginStore = {
    async findByToken(accountId, token) {
      return (
        state.rows.find(
          (r) =>
            r.account_id === accountId &&
            r.lead_token === token &&
            r.contact_id === null
        ) ?? null
      );
    },
    async findPendingByPhone(accountId, phone, sinceIso) {
      const matches = state.rows
        .filter(
          (r) =>
            r.account_id === accountId &&
            r.phone === phone &&
            r.contact_id === null &&
            r.touched_at >= sinceIso
        )
        .sort((a, b) => b.touched_at.localeCompare(a.touched_at));
      return matches[0] ?? null;
    },
    async findPrimaryByContact(accountId, contactId) {
      return (
        state.rows.find(
          (r) =>
            r.account_id === accountId &&
            r.contact_id === contactId &&
            r.is_primary
        ) ?? null
      );
    },
    async insertOrigin(input: NewLeadOrigin) {
      const row = makeRow({ ...input, id: `origin-${state.rows.length + 1}` });
      state.rows.push(row);
      return row;
    },
    async attachContact(originId, contactId) {
      const row = state.rows.find((r) => r.id === originId);
      if (row) row.contact_id = contactId;
    },
    async setPrimary(originId) {
      const row = state.rows.find((r) => r.id === originId);
      if (!row) return false;
      row.is_primary = true;
      return true;
    },
    async isTokenTaken(accountId, token) {
      return state.rows.some(
        (r) => r.account_id === accountId && r.lead_token === token
      );
    },
  };
  return { store, state };
}

const BASE = {
  accountId: 'acc-1',
  contactId: 'contact-1',
  provider: 'meta' as const,
  touchedAt: NOW_ISO,
};

describe('resolveOrigin', () => {
  it('binds the pending origin found by the token', async () => {
    const pending = makeRow({
      id: 'origin-token',
      lead_token: 'A7X9K2M4',
      utm_source: 'instagram',
    });
    const { store, state } = makeStore([pending]);

    const result = await resolveOrigin(store, {
      ...BASE,
      phone: '5511999999999',
      leadToken: 'A7X9K2M4',
    });

    expect(result.matchedBy).toBe('token');
    expect(state.rows[0].contact_id).toBe('contact-1');
    expect(state.rows[0].is_primary).toBe(true);
  });

  it('prefers the token over the phone', async () => {
    const byToken = makeRow({ id: 'origin-token', lead_token: 'A7X9K2M4' });
    const byPhone = makeRow({ id: 'origin-phone', phone: '5511999999999' });
    const { store } = makeStore([byToken, byPhone]);

    const result = await resolveOrigin(store, {
      ...BASE,
      phone: '5511999999999',
      leadToken: 'A7X9K2M4',
    });

    expect(result.matchedBy).toBe('token');
    expect(result.origin?.id).toBe('origin-token');
  });

  it('binds the pending origin found by the phone', async () => {
    const pending = makeRow({
      id: 'origin-phone',
      phone: '5511999999999',
      utm_source: 'instagram',
    });
    const { store, state } = makeStore([pending]);

    const result = await resolveOrigin(store, {
      ...BASE,
      phone: '5511999999999',
    });

    expect(result.matchedBy).toBe('phone');
    expect(state.rows[0].contact_id).toBe('contact-1');
    expect(state.rows[0].is_primary).toBe(true);
  });

  it('ignores a pending origin older than the window', async () => {
    const old = makeRow({
      id: 'origin-old',
      phone: '5511999999999',
      touched_at: LONG_AGO_ISO,
    });
    const { store } = makeStore([old]);

    const result = await resolveOrigin(store, {
      ...BASE,
      phone: '5511999999999',
    });

    expect(result.matchedBy).toBe('direct');
    expect(PHONE_MATCH_WINDOW_DAYS).toBe(30);
  });

  it('does not steal an origin that already belongs to a contact', async () => {
    const taken = makeRow({
      id: 'origin-taken',
      lead_token: 'A7X9K2M4',
      contact_id: 'someone-else',
    });
    const { store } = makeStore([taken]);

    const result = await resolveOrigin(store, {
      ...BASE,
      leadToken: 'A7X9K2M4',
    });

    expect(result.matchedBy).toBe('direct');
    expect(taken.contact_id).toBe('someone-else');
  });

  it('creates a direct origin when nothing matches', async () => {
    const { store, state } = makeStore();

    const result = await resolveOrigin(store, { ...BASE });

    expect(result.matchedBy).toBe('direct');
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].channel).toBe('direct');
    expect(state.rows[0].provider).toBe('meta');
    expect(state.rows[0].is_primary).toBe(true);
  });

  it('creates an origin from the provider referral', async () => {
    const { store, state } = makeStore();

    const result = await resolveOrigin(store, {
      ...BASE,
      referral: {
        ad_id: 'ad-1',
        adset_id: 'adset-1',
        campaign_id: 'camp-1',
        creative_id: 'creative-1',
      },
    });

    expect(result.matchedBy).toBe('referral');
    expect(state.rows[0].ad_id).toBe('ad-1');
    expect(state.rows[0].campaign_id).toBe('camp-1');
    expect(state.rows[0].is_primary).toBe(true);
  });

  it('does not create a second row when the touch repeats the same campaign', async () => {
    const primary = makeRow({
      id: 'origin-1',
      contact_id: 'contact-1',
      is_primary: true,
      campaign_id: 'camp-1',
    });
    const { store, state } = makeStore([primary]);

    const result = await resolveOrigin(store, {
      ...BASE,
      referral: { campaign_id: 'camp-1' },
    });

    expect(result.matchedBy).toBe('existing');
    expect(state.rows).toHaveLength(1);
  });

  it('creates a second row when the touch brings another campaign', async () => {
    const primary = makeRow({
      id: 'origin-1',
      contact_id: 'contact-1',
      is_primary: true,
      campaign_id: 'camp-1',
    });
    const { store, state } = makeStore([primary]);

    const result = await resolveOrigin(store, {
      ...BASE,
      referral: { campaign_id: 'camp-2' },
    });

    expect(result.matchedBy).toBe('referral');
    expect(state.rows).toHaveLength(2);
    expect(state.rows[1].is_primary).toBe(false);
  });

  it('does not change the primary of a contact that already has one', async () => {
    const primary = makeRow({
      id: 'origin-1',
      contact_id: 'contact-1',
      is_primary: true,
      channel: 'direct',
    });
    const pending = makeRow({
      id: 'origin-2',
      lead_token: 'A7X9K2M4',
      utm_campaign: 'verao',
    });
    const { store, state } = makeStore([primary, pending]);

    await resolveOrigin(store, { ...BASE, leadToken: 'A7X9K2M4' });

    expect(state.rows[0].is_primary).toBe(true);
    expect(state.rows[1].is_primary).toBe(false);
    expect(state.rows[1].contact_id).toBe('contact-1');
  });

  it('keeps the raw text in the meta of the created origin', async () => {
    const { store, state } = makeStore();

    await resolveOrigin(store, { ...BASE, rawText: 'Olá ref A7X9K2M4' });

    expect(state.rows[0].meta.raw_text).toBe('Olá ref A7X9K2M4');
  });
});

describe('generateUniqueLeadToken', () => {
  it('retries until the code is free', async () => {
    const taken = makeRow({ id: 'origin-1', lead_token: 'AAAAAAAA' });
    const { store } = makeStore([taken]);

    const codes = ['AAAAAAAA', 'BBBBBBBB'];
    let index = 0;
    const token = await generateUniqueLeadToken(
      store,
      'acc-1',
      5,
      () => codes[index++] ?? 'CCCCCCCC'
    );

    expect(token).toBe('BBBBBBBB');
  });

  it('gives up after the attempts are exhausted', async () => {
    const taken = makeRow({ id: 'origin-1', lead_token: 'AAAAAAAA' });
    const { store } = makeStore([taken]);

    let calls = 0;
    const token = await generateUniqueLeadToken(store, 'acc-1', 2, () => {
      calls += 1;
      return 'AAAAAAAA';
    });

    expect(calls).toBe(2);
    expect(token).toBe('AAAAAAAA');
  });
});
