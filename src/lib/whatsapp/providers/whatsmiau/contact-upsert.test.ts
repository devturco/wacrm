import { describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { handleWhatsmiauContactUpsert } from './contact-upsert';
import { fakeMediaStorage } from '@/lib/media/storage/fake-storage.test-helper';

const h = vi.hoisted(() => ({
  findExistingContact: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  avatarFailedRecently: vi.fn(async (): Promise<boolean> => false),
  storeContactAvatar: vi.fn(
    async (args: unknown): Promise<
      { ok: true; publicUrl: string; path: string } | { ok: false; reason: string }
    > => {
      void args;
      return {
        ok: true,
        publicUrl: 'https://cdn.test/avatars/contact-1.jpg',
        path: 'account-acc-1/avatars/contact-1.jpg',
      };
    },
  ),
}));

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: h.findExistingContact,
}));

vi.mock('./avatar', () => ({
  avatarFailedRecently: h.avatarFailedRecently,
  storeContactAvatar: h.storeContactAvatar,
}));

const db = { from: () => ({}) } as unknown as SupabaseClient;
const storage = fakeMediaStorage().storage;

const ctx = { db, accountId: 'acc-1', storage };

describe('handleWhatsmiauContactUpsert', () => {
  it('stores the picture the provider pushed', async () => {
    h.findExistingContact.mockResolvedValue({ id: 'contact-1', phone: '5511999988888' });

    await handleWhatsmiauContactUpsert(ctx, {
      phone: '5511999988888',
      profilePicUrl: 'https://cdn.test/original.jpg',
    });

    expect(h.storeContactAvatar).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        contactId: 'contact-1',
        url: 'https://cdn.test/original.jpg',
      }),
    );
  });

  it('never creates a contact out of a contact event', async () => {
    // The push may name anyone in the customer's phone book. Only a
    // message puts a contact in the inbox.
    h.findExistingContact.mockResolvedValue(null);

    await handleWhatsmiauContactUpsert(ctx, {
      phone: '5511999988888',
      profilePicUrl: 'https://cdn.test/original.jpg',
    });

    expect(h.storeContactAvatar).not.toHaveBeenCalled();
  });

  it('does nothing when the push carries no picture', async () => {
    h.findExistingContact.mockResolvedValue({ id: 'contact-1', phone: '5511999988888' });

    await handleWhatsmiauContactUpsert(ctx, {
      phone: '5511999988888',
      profilePicUrl: '',
    });

    expect(h.findExistingContact).not.toHaveBeenCalled();
    expect(h.storeContactAvatar).not.toHaveBeenCalled();
  });

  it('leaves a contact that already has a picture alone', async () => {
    // Ours is a durable copy of the provider's url — the provider's
    // url expires, ours does not. A new url changes nothing.
    h.findExistingContact.mockResolvedValue({
      id: 'contact-1',
      phone: '5511999988888',
      avatar_url: 'https://cdn.test/avatars/contact-1.jpg',
    });

    await handleWhatsmiauContactUpsert(ctx, {
      phone: '5511999988888',
      profilePicUrl: 'https://cdn.test/original.jpg',
    });

    expect(h.storeContactAvatar).not.toHaveBeenCalled();
  });

  it('does not throw when the storage says no', async () => {
    h.findExistingContact.mockResolvedValue({ id: 'contact-1', phone: '5511999988888' });
    h.storeContactAvatar.mockResolvedValue({ ok: false, reason: 'storage_failed' });

    await expect(
      handleWhatsmiauContactUpsert(ctx, {
        phone: '5511999988888',
        profilePicUrl: 'https://cdn.test/original.jpg',
      }),
    ).resolves.toBeUndefined();
  });

  it('waits for the window when the last attempt failed', async () => {
    // A storage that says no must not turn every push into a download
    // of the same picture.
    h.findExistingContact.mockResolvedValue({ id: 'contact-1', phone: '5511999988888' });
    h.avatarFailedRecently.mockResolvedValue(true);

    await handleWhatsmiauContactUpsert(ctx, {
      phone: '5511999988888',
      profilePicUrl: 'https://cdn.test/original.jpg',
    });

    expect(h.storeContactAvatar).not.toHaveBeenCalled();
  });
});
