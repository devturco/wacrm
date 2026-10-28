import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { WhatsmiauConnection } from '../types';
import {
  WhatsmiauApiError,
  mapWhatsmiauStatus,
  whatsmiauRequest,
} from './client';

const conn: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'Atendimento01',
  apiKey: 'key-1',
  baseUrl: 'https://api.whatsmiau.dev/v2',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('whatsmiau client — request shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the configured base url with the apikey header', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    await whatsmiauRequest(conn, {
      method: 'POST',
      path: '/message/sendText/Atendimento01',
      body: { number: '5511999998888', text: 'oi' },
    });

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.whatsmiau.dev/v2/message/sendText/Atendimento01');
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe('key-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ number: '5511999998888', text: 'oi' });
  });

  it('honours a custom base url', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));

    await whatsmiauRequest(
      { ...conn, baseUrl: 'https://self.hosted.example/api/' },
      { path: '/instance/fetchInstances' },
    );

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://self.hosted.example/api/instance/fetchInstances');
  });

  it('returns the parsed body on 2xx', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'MSG_1' } }));
    const result = await whatsmiauRequest<{ key: { id: string } }>(conn, {
      path: '/message/sendText/Atendimento01',
      method: 'POST',
    });
    expect(result.key.id).toBe('MSG_1');
  });

  it('omits the body for a GET', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await whatsmiauRequest(conn, { path: '/instance/fetchInstances' });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBeUndefined();
  });
});

describe('whatsmiau client — errors', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps 401 to an unauthorized error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'invalid api key' }, 401),
    );
    await expect(whatsmiauRequest(conn, { path: '/x' })).rejects.toBeInstanceOf(
      WhatsmiauApiError,
    );
    await whatsmiauRequest(conn, { path: '/x' }).catch((e: WhatsmiauApiError) => {
      expect(e.code).toBe('whatsmiau_unauthorized');
      expect(e.status).toBe(401);
    });
  });

  it('maps 423 to a suspension error and keeps the reason', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'suspended', suspension_reason: 'billing_past_due' }, 423),
    );
    await whatsmiauRequest(conn, { path: '/x' }).catch((e: WhatsmiauApiError) => {
      expect(e.code).toBe('whatsmiau_suspended');
      expect(e.status).toBe(409);
      expect(e.message).toContain('billing_past_due');
    });
  });

  it('maps any other failure to a generic provider error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ message: 'boom' }, 500));
    await whatsmiauRequest(conn, { path: '/x' }).catch((e: WhatsmiauApiError) => {
      expect(e.code).toBe('whatsmiau_error');
      expect(e.status).toBe(502);
      expect(e.raw).toEqual({ message: 'boom' });
    });
  });

  it('wraps a network failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    await whatsmiauRequest(conn, { path: '/x' }).catch((e: WhatsmiauApiError) => {
      expect(e.code).toBe('whatsmiau_network');
      expect(e.message).toContain('ECONNREFUSED');
    });
  });
});

describe('whatsmiau status mapping', () => {
  it('maps the documented statuses', () => {
    expect(mapWhatsmiauStatus(401)).toEqual({ code: 'whatsmiau_unauthorized', httpStatus: 401 });
    expect(mapWhatsmiauStatus(403)).toEqual({ code: 'whatsmiau_unauthorized', httpStatus: 401 });
    expect(mapWhatsmiauStatus(423)).toEqual({ code: 'whatsmiau_suspended', httpStatus: 409 });
    expect(mapWhatsmiauStatus(404)).toEqual({ code: 'whatsmiau_not_found', httpStatus: 404 });
    expect(mapWhatsmiauStatus(409)).toEqual({ code: 'whatsmiau_conflict', httpStatus: 409 });
    expect(mapWhatsmiauStatus(400)).toEqual({ code: 'whatsmiau_invalid_request', httpStatus: 400 });
    expect(mapWhatsmiauStatus(500)).toEqual({ code: 'whatsmiau_error', httpStatus: 502 });
  });
});
