import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { createLeadSettingsStore } from './store';

/** What the store asked the database for. */
interface ContainsCall {
  column: string;
  value: unknown;
}

/** What the store asked the database for, by equality. */
interface EqCall {
  column: string;
  value: unknown;
}

/**
 * A database that answers the two questions the campaign link asks —
 * "which account owns this code?" and "which account owns this
 * capture key?" — and remembers how it was asked.
 */
function makeDb(rows: Record<string, unknown>[] | null) {
  const contains: ContainsCall[] = [];
  const eq: EqCall[] = [];

  const db = {
    from(_table: string) {
      return {
        select(_columns: string) {
          const answer = { limit: () => Promise.resolve({ data: rows, error: null }) };
          return {
            eq(column: string, value: unknown) {
              eq.push({ column, value });
              return answer;
            },
            contains(column: string, value: unknown) {
              contains.push({ column, value });
              return answer;
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as SupabaseClient, contains, eq };
}

/**
 * How the filter really goes out on the wire.
 *
 * supabase-js serializes `.contains()` three different ways depending
 * on the value: a string becomes `cs.<text>`, an array becomes
 * `cs.{a,b}` — a Postgres ARRAY filter — and an object becomes
 * `cs.{"code":"..."}`, the JSONB containment. On a JSONB column only
 * the last one parses, so the SHAPE of the value IS the query.
 */
function wireFilter(value: unknown): string {
  const client = createClient('https://example.supabase.co', 'test-key');
  const builder = client
    .from('lead_settings')
    .select('*')
    .contains('links', value as Record<string, unknown>);
  const url = (builder as unknown as { url: URL }).url;
  return url.searchParams.get('links') ?? '';
}

describe('findByLinkCode', () => {
  it('finds the account that owns the campaign code', async () => {
    const { db } = makeDb([
      {
        account_id: 'acc-1',
        capture_key: 'pk_1',
        enabled: true,
        allowed_hosts: [],
        links: [{ code: 'abcdefgh', label: 'Outubro', destination: 'wa:5511999999999' }],
      },
    ]);

    const settings = await createLeadSettingsStore(db).findByLinkCode('abcdefgh');

    expect(settings?.account_id).toBe('acc-1');
    expect(settings?.links).toHaveLength(1);
  });

  it('is null when no account owns the code', async () => {
    const { db } = makeDb(null);
    const settings = await createLeadSettingsStore(db).findByLinkCode('abcdefgh');
    expect(settings).toBeNull();
  });

  it('asks for the code with a filter Postgres can parse', async () => {
    // The value MUST be an object. An array is serialized as
    // `cs.{[object Object]}` — the string "[object Object]" — and
    // Postgres rejects it with "invalid input syntax for type json".
    const { db, contains } = makeDb(null);
    await createLeadSettingsStore(db).findByLinkCode('abcdefgh');

    expect(contains).toEqual([{ column: 'links', value: { code: 'abcdefgh' } }]);
    expect(wireFilter(contains[0]?.value)).toBe('cs.{"code":"abcdefgh"}');
  });

  it('the array form would be a filter Postgres cannot parse', () => {
    // The trap, pinned: this is what the query looked like when the
    // link code was looked up with an array.
    expect(wireFilter([{ code: 'abcdefgh' }])).toBe('cs.{[object Object]}');
  });
});

describe('findByCaptureKey', () => {
  it('finds the account that owns the capture key', async () => {
    const { db, eq } = makeDb([
      {
        account_id: 'acc-2',
        capture_key: 'pk_2',
        enabled: true,
        allowed_hosts: ['site.com.br'],
        links: [],
      },
    ]);

    const settings = await createLeadSettingsStore(db).findByCaptureKey('pk_2');

    expect(settings?.account_id).toBe('acc-2');
    expect(settings?.allowed_hosts).toEqual(['site.com.br']);
    expect(eq).toEqual([{ column: 'capture_key', value: 'pk_2' }]);
  });
});
