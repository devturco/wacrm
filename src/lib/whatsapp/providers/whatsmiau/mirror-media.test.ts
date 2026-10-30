import { describe, expect, it, vi } from 'vitest';

import {
  downloadWhatsmiauMedia,
  mirrorWhatsmiauMedia,
  type MirrorWhatsmiauMediaArgs,
} from './mirror-media';
import { fakeMediaStorage } from '@/lib/media/storage/fake-storage.test-helper';
import { inboundSegment } from '@/lib/media/layout';

function fakeStorage(publicBase = 'https://cdn.test/public.png') {
  const fake = fakeMediaStorage({ publicBase, accountId: ACCOUNT });
  return { storage: fake.storage, uploads: fake.puts };
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

const ACCOUNT = 'acc-1';

const baseArgs = {
  mediaId: 'MSG_001',
  mimeType: 'image/png',
} satisfies Partial<MirrorWhatsmiauMediaArgs>;

describe('mirrorWhatsmiauMedia', () => {
  it('downloads the public url and stores it in the account storage', async () => {
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
    expect(uploads[0]?.path).toContain('midias');
    expect(uploads[0]?.contentType).toBe('image/png');
    expect(url).toContain('https://cdn.test/public.png');
  });

  it('writes to the backend the account chose — R2 when that is the setting', async () => {
    // The mirror used to be hardcoded to the Supabase bucket, so an
    // account on R2 received every photo there while the composer
    // wrote to R2. Both directions now follow the same setting.
    const fake = fakeMediaStorage({
      backend: 'r2',
      bucket: 'crmbr-media',
      publicBase: 'https://media.test',
      accountId: ACCOUNT,
      accountName: 'Storm Eletrônicos',
    });
    const download = vi.fn(async () => ({
      stream: fakeStream(3),
      contentType: 'image/png',
    }));

    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage: fake.storage,
      mediaUrl: 'https://cdn.test/original.png',
      download,
    } as MirrorWhatsmiauMediaArgs);

    expect(fake.puts).toHaveLength(1);
    // R2 has no RLS: the company's own folder is the boundary.
    expect(fake.puts[0]?.path).toBe(
      `storm-eletronicos-acc1/midias/${inboundSegment('MSG_001')}/image.png`,
    );
    expect(url).toBe(
      `https://media.test/storm-eletronicos-acc1/midias/${inboundSegment('MSG_001')}/image.png`,
    );
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

    // .../documentos/<hash>/contrato.pdf — the last segment IS the name.
    expect(uploads[0]?.path).toBe(
      `account-acc-1/documentos/${inboundSegment('3EB0C767D-A1B2')}/contrato.pdf`,
    );
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
    // The bytes are in hand — their length is declared.
    expect(uploads[0]?.contentLength).toBe(5);
  });

  it('declares the length the provider announced', async () => {
    // R2's S3 API refuses a PUT whose length it cannot know: a stream
    // without a Content-Length goes out as `Transfer-Encoding:
    // chunked` and the bucket answers "length required" — the upload
    // dies and the attachment stays on the provider's own server.
    const { storage, uploads } = fakeStorage();
    const download = vi.fn(async () => ({
      stream: fakeStream(3),
      contentType: 'image/png',
      contentLength: 3,
    }));

    await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaUrl: 'https://cdn.test/original.png',
      download,
    } as MirrorWhatsmiauMediaArgs);

    expect(uploads[0]?.contentLength).toBe(3);
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

  it('reads the length off the response, so the upload can declare it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': '4096',
        }),
        body: (() => {
          let sent = false;
          return {
            getReader: () => ({
              read: async () => {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: new Uint8Array(10) };
              },
              cancel: async () => {},
            }),
          };
        })(),
      })),
    );

    const { contentLength } = await downloadWhatsmiauMedia(
      'https://cdn.test/x',
      1024,
    );
    expect(contentLength).toBe(4096);
    vi.unstubAllGlobals();
  });

  it('ignores the length of a compressed body — it counts the wrong bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': '40',
          'content-encoding': 'gzip',
        }),
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

    const { contentLength } = await downloadWhatsmiauMedia(
      'https://cdn.test/x',
      1024,
    );
    expect(contentLength).toBeNull();
    vi.unstubAllGlobals();
  });
});
