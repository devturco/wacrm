import { describe, expect, it, vi } from 'vitest';

import {
  downloadWhatsmiauMedia,
  mirrorWhatsmiauMedia,
  type MirrorWhatsmiauMediaArgs,
} from './mirror-media';
import type { MirrorStorage } from '@/lib/whatsapp/mirror-inbound-media';

function fakeStorage(publicUrl = 'https://cdn.test/public.png') {
  const uploads: { path: string; contentType: string }[] = [];
  const storage: MirrorStorage = {
    from: () => ({
      upload: async (path: string, _body: Uint8Array | Buffer, options: { contentType: string }) => {
        uploads.push({ path, contentType: options.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `${publicUrl}#${path}` } }),
    }),
  };
  return { storage, uploads };
}

const baseArgs = {
  accountId: 'acc-1',
  mediaId: 'MSG_001',
  mimeType: 'image/png',
} satisfies Partial<MirrorWhatsmiauMediaArgs>;

describe('mirrorWhatsmiauMedia', () => {
  it('downloads the public url and stores it in chat-media', async () => {
    const { storage, uploads } = fakeStorage();
    const download = vi.fn(async () => ({
      buffer: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    }));

    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaUrl: 'https://cdn.test/original.png',
      download,
    } as MirrorWhatsmiauMediaArgs);

    expect(download).toHaveBeenCalledWith('https://cdn.test/original.png');
    expect(uploads[0]?.path).toContain('account-acc-1');
    expect(uploads[0]?.path).toContain('inbound');
    expect(uploads[0]?.contentType).toBe('image/png');
    expect(url).toContain('https://cdn.test/public.png');
  });

  it('falls back to the base64 payload when there is no url', async () => {
    const { storage, uploads } = fakeStorage();
    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaBase64: Buffer.from('hello').toString('base64'),
    } as MirrorWhatsmiauMediaArgs);

    expect(uploads).toHaveLength(1);
    expect(url).toBeTruthy();
  });

  it('returns null when the download fails', async () => {
    const { storage } = fakeStorage();
    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaUrl: 'https://cdn.test/gone.png',
      download: async () => {
        throw new Error('404');
      },
    } as MirrorWhatsmiauMediaArgs);

    expect(url).toBeNull();
  });

  it('returns null when there is neither url nor base64', async () => {
    const { storage, uploads } = fakeStorage();
    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
    } as MirrorWhatsmiauMediaArgs);

    expect(url).toBeNull();
    expect(uploads).toHaveLength(0);
  });
});

describe('downloadWhatsmiauMedia', () => {
  it('throws when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(downloadWhatsmiauMedia('https://cdn.test/x')).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });
});
