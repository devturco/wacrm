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
      upload: async (
        path: string,
        _body: ReadableStream<Uint8Array> | Uint8Array | Buffer,
        options: { contentType: string },
      ) => {
        uploads.push({ path, contentType: options.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `${publicUrl}#${path}` } }),
    }),
  };
  return { storage, uploads };
}

/** A stream carrying `bytes` bytes, like the real downloader returns. */
function fakeStream(bytes: number) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
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
      stream: fakeStream(3),
      contentType: 'image/png',
    }));

    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaUrl: 'https://cdn.test/original.png',
      download,
    } as MirrorWhatsmiauMediaArgs);

    expect(download).toHaveBeenCalledWith('https://cdn.test/original.png', 104857600);
    expect(uploads[0]?.path).toContain('account-acc-1');
    expect(uploads[0]?.path).toContain('inbound');
    expect(uploads[0]?.contentType).toBe('image/png');
    expect(url).toContain('https://cdn.test/public.png');
  });

  it('keeps the media id in its own path segment, so the name stays clean', async () => {
    const { storage, uploads } = fakeStorage();
    const download = vi.fn(async () => ({
      stream: fakeStream(3),
      contentType: 'application/pdf',
    }));

    await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaId: '3EB0C767D-A1B2',
      mimeType: 'application/pdf',
      fileName: 'contrato.pdf',
      mediaUrl: 'https://cdn.test/original.pdf',
      download,
    } as MirrorWhatsmiauMediaArgs);

    // .../inbound/<id>/contrato.pdf — the last segment IS the name.
    expect(uploads[0]?.path).toBe('account-acc-1/inbound/3EB0C767D-A1B2/contrato.pdf');
  });

  it('declares an unknown format as a download, never as active content', async () => {
    const { storage, uploads } = fakeStorage();
    const download = vi.fn(async () => ({
      stream: fakeStream(3),
      contentType: 'text/html',
    }));

    await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mimeType: 'text/html',
      mediaUrl: 'https://cdn.test/x.html',
      download,
    } as MirrorWhatsmiauMediaArgs);

    expect(uploads[0]?.contentType).toBe('application/octet-stream');
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
    await expect(downloadWhatsmiauMedia('https://cdn.test/x', 1024)).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });

  it('cuts the stream once the bytes pass the limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/pdf' }),
        body: (() => {
          let sent = false;
          return {
            getReader: () => ({
              read: async () => {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: new Uint8Array(100) };
              },
              cancel: async () => {},
            }),
          };
        })(),
      })),
    );

    const { stream } = await downloadWhatsmiauMedia('https://cdn.test/x', 50);
    await expect(
      new Response(stream).arrayBuffer(),
    ).rejects.toThrow(/exceeds/);
    vi.unstubAllGlobals();
  });
});
