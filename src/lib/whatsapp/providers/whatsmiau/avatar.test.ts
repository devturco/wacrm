import { describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { AVATAR_RECHECK_AFTER_MS, refreshContactAvatar } from './avatar';
import { fakeMediaStorage } from '@/lib/media/storage/fake-storage.test-helper';
import type { WhatsmiauConnection } from '../types';

const h = vi.hoisted(() => ({
  fetchProfilePictureUrl: vi.fn(
    async (conn: unknown, phone: string): Promise<string | null> => {
      // The arguments are asserted through `mock.calls`.
      void conn;
      void phone;
      return null;
    },
  ),
  mirrorProfilePicture: vi.fn(
    async (args: unknown): Promise<{ publicUrl: string; path: string } | null> => {
      void args;
      return null;
    },
  ),
}));

vi.mock('./profile-picture', () => ({
  fetchProfilePictureUrl: h.fetchProfilePictureUrl,
  mirrorProfilePicture: h.mirrorProfilePicture,
}));

type Row = Record<string, unknown>;
interface Queued {
  data?: unknown;
  error?: unknown;
}

interface Call {
  table: string;
  op: string;
  payload?: Row;
}

/**
 * A Supabase double with one answer per table: the avatar record is
 * read from `contact_avatars` and written back to it, while the
 * contact's own row is updated in `contacts`.
 */
function fakeDb(options: {
  record?: Queued;
  recordWrite?: Queued;
  contactWrite?: Queued;
}) {
  const calls: Call[] = [];

  const from = (table: string) => {
    let op = 'select';
    let payload: Row | undefined;
    const api = {
      select: () => api,
      update: (row: Row) => {
        op = 'update';
        payload = row;
        return api;
      },
      upsert: (row: Row) => {
        op = 'upsert';
        payload = row;
        return api;
      },
      eq: () => api,
      maybeSingle: async () => {
        calls.push({ table, op, payload });
        return options.record ?? { data: null, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => {
        calls.push({ table, op, payload });
        const result =
          table === 'contacts' ? options.contactWrite : options.recordWrite;
        return Promise.resolve(resolve(result ?? { error: null }));
      },
    };
    return api;
  };

  const db = { from } as unknown as SupabaseClient;
  return { db, calls };
}

const connection: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'acme_lojista',
  apiKey: 'key-test',
  baseUrl: 'https://api.test/v2',
};

const storage = fakeMediaStorage().storage;

const NOW = new Date('2026-10-29T12:00:00.000Z');

function refresh(
  db: SupabaseClient,
  overrides: {
    phone?: string;
    currentAvatarUrl?: string | null;
    now?: Date;
  } = {},
) {
  return refreshContactAvatar({
    db,
    accountId: 'acc-1',
    storage,
    conn: connection,
    contactId: 'contact-1',
    phone: overrides.phone ?? '5511999988888',
    currentAvatarUrl: overrides.currentAvatarUrl ?? null,
    now: overrides.now ?? NOW,
  });
}

describe('refreshContactAvatar', () => {
  it('does nothing when the contact already has a picture', async () => {
    const { db, calls } = fakeDb({});

    await refresh(db, { currentAvatarUrl: 'https://cdn.test/avatars/contact-1.jpg' });

    expect(h.fetchProfilePictureUrl).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('asks the provider and stores the picture on the contact', async () => {
    h.fetchProfilePictureUrl.mockResolvedValue('https://cdn.test/original.jpg');
    h.mirrorProfilePicture.mockResolvedValue({
      publicUrl: 'https://cdn.test/avatars/contact-1.jpg',
      path: 'account-acc-1/avatars/contact-1.jpg',
    });
    const { db, calls } = fakeDb({});

    await refresh(db);

    expect(h.fetchProfilePictureUrl).toHaveBeenCalledWith(
      connection,
      '5511999988888',
    );
    const contactUpdate = calls.find(
      (c) => c.table === 'contacts' && c.op === 'update',
    );
    expect(contactUpdate?.payload).toEqual({
      avatar_url: 'https://cdn.test/avatars/contact-1.jpg',
    });
    const record = calls.find(
      (c) => c.table === 'contact_avatars' && c.op === 'upsert',
    );
    expect(record?.payload).toMatchObject({
      contact_id: 'contact-1',
      account_id: 'acc-1',
      status: 'found',
      storage_path: 'account-acc-1/avatars/contact-1.jpg',
    });
  });

  it('records a contact without a picture as missing', async () => {
    h.fetchProfilePictureUrl.mockResolvedValue(null);
    h.mirrorProfilePicture.mockResolvedValue(null);
    const { db, calls } = fakeDb({});

    await refresh(db);

    expect(h.mirrorProfilePicture).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === 'contacts')).toBe(false);
    const record = calls.find(
      (c) => c.table === 'contact_avatars' && c.op === 'upsert',
    );
    expect(record?.payload).toMatchObject({ status: 'missing' });
  });

  it('records a provider failure as pending, never as missing', async () => {
    h.fetchProfilePictureUrl.mockRejectedValue(new Error('provider is down'));
    const { db, calls } = fakeDb({});

    await refresh(db);

    const record = calls.find(
      (c) => c.table === 'contact_avatars' && c.op === 'upsert',
    );
    expect(record?.payload).toMatchObject({ status: 'pending' });
  });

  it('records a failed mirror as pending, so it is tried again', async () => {
    h.fetchProfilePictureUrl.mockResolvedValue('https://cdn.test/original.jpg');
    h.mirrorProfilePicture.mockResolvedValue(null);
    const { db, calls } = fakeDb({});

    await refresh(db);

    expect(calls.some((c) => c.table === 'contacts')).toBe(false);
    const record = calls.find(
      (c) => c.table === 'contact_avatars' && c.op === 'upsert',
    );
    expect(record?.payload).toMatchObject({ status: 'pending' });
  });

  it('does not ask again within a day of a check that found nothing', async () => {
    const { db } = fakeDb({
      record: {
        data: { status: 'missing', checked_at: '2026-10-29T11:00:00.000Z' },
        error: null,
      },
    });

    await refresh(db);

    expect(h.fetchProfilePictureUrl).not.toHaveBeenCalled();
  });

  it('asks again once the day has passed', async () => {
    h.fetchProfilePictureUrl.mockResolvedValue(null);
    const checkedAt = new Date(
      NOW.getTime() - AVATAR_RECHECK_AFTER_MS - 60_000,
    ).toISOString();
    const { db } = fakeDb({
      record: { data: { status: 'missing', checked_at: checkedAt }, error: null },
    });

    await refresh(db);

    expect(h.fetchProfilePictureUrl).toHaveBeenCalled();
  });

  it('asks again when the last check found a picture that has since gone', async () => {
    h.fetchProfilePictureUrl.mockResolvedValue(null);
    const { db } = fakeDb({
      record: {
        data: { status: 'found', checked_at: '2026-10-28T12:00:00.000Z' },
        error: null,
      },
    });

    await refresh(db);

    expect(h.fetchProfilePictureUrl).toHaveBeenCalled();
  });

  it('still works when the migration has not been applied', async () => {
    h.fetchProfilePictureUrl.mockResolvedValue(null);
    const { db, calls } = fakeDb({
      record: { data: null, error: { code: '42P01', message: 'relation missing' } },
    });

    await refresh(db);

    // The table is gone, so nothing is remembered — but the picture is
    // still looked for.
    expect(h.fetchProfilePictureUrl).toHaveBeenCalled();
    const record = calls.find(
      (c) => c.table === 'contact_avatars' && c.op === 'upsert',
    );
    expect(record?.payload).toMatchObject({ status: 'missing' });
  });
});
