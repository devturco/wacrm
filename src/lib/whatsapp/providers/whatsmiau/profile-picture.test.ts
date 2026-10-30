import { describe, expect, it, vi } from 'vitest';

import {
  PROFILE_PICTURE_MAX_BYTES,
  downloadProfilePicture,
  fetchProfilePictureUrl,
  imageTypeFor,
  isFetchableImageUrl,
  mirrorProfilePicture,
  readProfilePictureUrl,
} from './profile-picture';
import { fakeMediaStorage } from '@/lib/media/storage/fake-storage.test-helper';
import type { WhatsmiauConnection } from '../types';

const h = vi.hoisted(() => ({
  request: vi.fn(async (conn: unknown, options: unknown): Promise<unknown> => {
    // The arguments are asserted through `mock.calls`.
    void conn;
    void options;
    return { profilePictureUrl: 'https://cdn.test/picture.jpg' };
  }),
}));

vi.mock('./client', () => ({
  whatsmiauRequest: h.request,
}));

const connection: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'acme_lojista',
  apiKey: 'key-test',
  baseUrl: 'https://api.test/v2',
};

function fakeStorage(publicBase = 'https://cdn.test/media') {
  const fake = fakeMediaStorage({ publicBase, accountId: 'acc-1' });
  return { storage: fake.storage, uploads: fake.puts };
}

describe('readProfilePictureUrl', () => {
  it('reads the documented shape', () => {
    expect(
      readProfilePictureUrl({ profilePictureUrl: 'https://cdn.test/a.jpg' }),
    ).toBe('https://cdn.test/a.jpg');
  });

  it('reads the spellings the provider has used', () => {
    expect(readProfilePictureUrl({ profilePicUrl: 'https://cdn.test/b.jpg' })).toBe(
      'https://cdn.test/b.jpg',
    );
    expect(readProfilePictureUrl({ pictureUrl: 'https://cdn.test/c.jpg' })).toBe(
      'https://cdn.test/c.jpg',
    );
    expect(
      readProfilePictureUrl({ data: { profilePictureUrl: 'https://cdn.test/d.jpg' } }),
    ).toBe('https://cdn.test/d.jpg');
  });

  it('accepts a bare url string', () => {
    expect(readProfilePictureUrl('https://cdn.test/e.jpg')).toBe('https://cdn.test/e.jpg');
  });

  it('answers null when there is no picture', () => {
    expect(readProfilePictureUrl({ profilePictureUrl: null })).toBeNull();
    expect(readProfilePictureUrl({})).toBeNull();
    expect(readProfilePictureUrl(null)).toBeNull();
    expect(readProfilePictureUrl(undefined)).toBeNull();
  });

  it('refuses a value that is not a url', () => {
    expect(readProfilePictureUrl({ profilePictureUrl: 'not-a-url' })).toBeNull();
    expect(readProfilePictureUrl({ profilePictureUrl: 'file:///etc/passwd' })).toBeNull();
  });
});

describe('fetchProfilePictureUrl', () => {
  it('asks the provider for the contact', async () => {
    h.request.mockResolvedValue({ profilePictureUrl: 'https://cdn.test/f.jpg' });

    const url = await fetchProfilePictureUrl(connection, '5511999988888');

    expect(url).toBe('https://cdn.test/f.jpg');
    expect(h.request).toHaveBeenCalledTimes(1);
    const [, options] = h.request.mock.calls[0]!;
    expect(options).toMatchObject({
      method: 'POST',
      path: '/chat/fetchProfilePictureUrl/acme_lojista',
      body: { number: '5511999988888' },
    });
  });

  it('answers null when the contact has no picture', async () => {
    h.request.mockResolvedValue({ profilePictureUrl: null });
    expect(await fetchProfilePictureUrl(connection, '5511999988888')).toBeNull();
  });
});

describe('isFetchableImageUrl', () => {
  it('accepts http and https', () => {
    expect(isFetchableImageUrl('https://cdn.test/a.jpg')).toBe(true);
    expect(isFetchableImageUrl('http://cdn.test/a.jpg')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isFetchableImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isFetchableImageUrl('file:///etc/passwd')).toBe(false);
    expect(isFetchableImageUrl('/relative/a.jpg')).toBe(false);
    expect(isFetchableImageUrl('nonsense')).toBe(false);
  });
});

describe('imageTypeFor', () => {
  it('maps the types the bucket accepts', () => {
    expect(imageTypeFor('image/png')).toEqual({ mime: 'image/png', ext: 'png' });
    expect(imageTypeFor('image/jpeg')).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(imageTypeFor('image/webp')).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(imageTypeFor('image/gif')).toEqual({ mime: 'image/gif', ext: 'gif' });
  });

  it('ignores the charset and the casing', () => {
    expect(imageTypeFor('image/JPEG; charset=binary')).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
  });

  it('falls back to jpeg for an unknown type', () => {
    expect(imageTypeFor('application/octet-stream')).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
    expect(imageTypeFor(null)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });
});

describe('mirrorProfilePicture', () => {
  it('copies the picture into the account folder of the account storage', async () => {
    const { storage, uploads } = fakeStorage();
    const download = vi.fn(async () => ({
      buffer: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    }));

    const mirrored = await mirrorProfilePicture({
      storage,
      contactId: 'contact-1',
      url: 'https://cdn.test/original.png',
      download,
    });

    expect(download).toHaveBeenCalledWith('https://cdn.test/original.png');
    expect(uploads[0]?.path).toBe('account-acc-1/avatar/contact-1.png');
    expect(uploads[0]?.contentType).toBe('image/png');
    expect(uploads[0]?.bytes).toBe(3);
    expect(mirrored.ok).toBe(true);
    if (!mirrored.ok) return;
    expect(mirrored.publicUrl).toBe(
      'https://cdn.test/media/account-acc-1/avatar/contact-1.png',
    );
    expect(mirrored.path).toBe('account-acc-1/avatar/contact-1.png');
  });

  it('refuses a url that is not fetchable', async () => {
    const { storage, uploads } = fakeStorage();
    const download = vi.fn();

    const mirrored = await mirrorProfilePicture({
      storage,
      contactId: 'contact-1',
      url: 'data:image/png;base64,AAAA',
      download,
    });

    expect(mirrored).toEqual({ ok: false, reason: 'unusable_url' });
    expect(download).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });

  it('says the download failed', async () => {
    const { storage, uploads } = fakeStorage();

    const mirrored = await mirrorProfilePicture({
      storage,
      contactId: 'contact-1',
      url: 'https://cdn.test/gone.png',
      download: async () => {
        throw new Error('404');
      },
    });

    expect(mirrored).toEqual({ ok: false, reason: 'download_failed' });
    expect(uploads).toHaveLength(0);
  });

  it('says the picture came back empty', async () => {
    const { storage, uploads } = fakeStorage();

    const mirrored = await mirrorProfilePicture({
      storage,
      contactId: 'contact-1',
      url: 'https://cdn.test/empty.png',
      download: async () => ({ buffer: new Uint8Array(0), contentType: 'image/png' }),
    });

    expect(mirrored).toEqual({ ok: false, reason: 'empty_picture' });
    expect(uploads).toHaveLength(0);
  });

  it('says the picture is over the limit', async () => {
    const { storage, uploads } = fakeStorage();

    const mirrored = await mirrorProfilePicture({
      storage,
      contactId: 'contact-1',
      url: 'https://cdn.test/huge.png',
      download: async () => ({
        buffer: new Uint8Array(PROFILE_PICTURE_MAX_BYTES + 1),
        contentType: 'image/png',
      }),
    });

    expect(mirrored).toEqual({ ok: false, reason: 'picture_too_large' });
    expect(uploads).toHaveLength(0);
  });

  it('says the storage refused the write', async () => {
    const fake = fakeMediaStorage({ failWith: 'bucket is full', accountId: 'acc-1' });

    const mirrored = await mirrorProfilePicture({
      storage: fake.storage,
      contactId: 'contact-1',
      url: 'https://cdn.test/a.png',
      download: async () => ({ buffer: new Uint8Array([1]), contentType: 'image/png' }),
    });

    expect(mirrored).toEqual({ ok: false, reason: 'storage_failed' });
  });

  it('says the storage took the object but gave no public url', async () => {
    // The write happened, but the object is unreachable — the account
    // would see no picture even though the bytes are there.
    const { storage } = fakeStorage();
    const blind = {
      ...storage,
      async put() {
        return { publicUrl: '', path: 'account-acc-1/avatars/contact-1.jpg', size: 1 };
      },
    };

    const mirrored = await mirrorProfilePicture({
      storage: blind,
      contactId: 'contact-1',
      url: 'https://cdn.test/a.png',
      download: async () => ({ buffer: new Uint8Array([1]), contentType: 'image/png' }),
    });

    expect(mirrored).toEqual({ ok: false, reason: 'no_public_url' });
  });
});

describe('downloadProfilePicture', () => {
  it('reads the body of the picture', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }),
      ),
    );

    const downloaded = await downloadProfilePicture('https://cdn.test/a.jpg');

    expect(downloaded.buffer).toEqual(bytes);
    expect(downloaded.contentType).toBe('image/jpeg');
    vi.unstubAllGlobals();
  });

  it('refuses a body that announces more than the limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(new Uint8Array([1]), {
          headers: { 'content-length': String(PROFILE_PICTURE_MAX_BYTES + 1) },
        }),
      ),
    );

    await expect(downloadProfilePicture('https://cdn.test/big.jpg')).rejects.toThrow(
      /limit/,
    );
    vi.unstubAllGlobals();
  });

  it('refuses a body that grows past the limit while it arrives', async () => {
    const chunk = new Uint8Array(1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // No content-length: the bytes are counted as they arrive.
        for (let i = 0; i < PROFILE_PICTURE_MAX_BYTES / chunk.byteLength + 2; i++) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { headers: { 'content-type': 'image/png' } })),
    );

    await expect(downloadProfilePicture('https://cdn.test/big.jpg')).rejects.toThrow(
      /limit/,
    );
    vi.unstubAllGlobals();
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );

    await expect(downloadProfilePicture('https://cdn.test/gone.jpg')).rejects.toThrow(
      /404/,
    );
    vi.unstubAllGlobals();
  });
});
