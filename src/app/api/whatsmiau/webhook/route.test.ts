import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeConfig {
  account_id: string;
  instance_name: string;
  webhook_secret: string;
  instance_settings: {
    alwaysOnline: boolean;
    readMessages: boolean;
    rejectCall: boolean;
    msgCall: string;
    groupsIgnore: boolean;
    saveMedia: boolean;
    webhook: {
      enabled: boolean;
      url: string;
      headers: Record<string, string>;
      events: string[];
      base64: boolean;
    };
  };
}

const h = vi.hoisted(() => ({
  afterCallbacks: [] as (() => Promise<void>)[],
  inbound: [] as unknown[],
  status: [] as unknown[],
  connection: [] as unknown[],
  edited: [] as unknown[],
  deleted: [] as unknown[],
  config: null as FakeConfig | null,
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void>) => {
    h.afterCallbacks.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      Response.json(body, init),
  },
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  }),
}));

vi.mock('@/lib/whatsapp/whatsmiau-config', () => ({
  loadWhatsmiauConfigByWebhookSecret: vi.fn(async (_db: unknown, secret: string) =>
    h.config?.webhook_secret === secret ? h.config : null,
  ),
}));

vi.mock('@/lib/whatsapp/providers/whatsmiau/inbound', () => ({
  resolveWhatsmiauOwnerUserId: vi.fn(async () => 'user-1'),
  handleWhatsmiauInboundMessage: vi.fn(async (_ctx: unknown, message: unknown) => {
    h.inbound.push(message);
    return { disposition: 'inserted' };
  }),
  handleWhatsmiauStatusUpdate: vi.fn(async (_ctx: unknown, update: unknown) => {
    h.status.push(update);
  }),
  handleWhatsmiauConnectionUpdate: vi.fn(async (_ctx: unknown, update: unknown) => {
    h.connection.push(update);
  }),
  handleWhatsmiauEditedMessage: vi.fn(async (_ctx: unknown, update: unknown) => {
    h.edited.push(update);
  }),
  handleWhatsmiauDeletedMessage: vi.fn(async (_ctx: unknown, update: unknown) => {
    h.deleted.push(update);
  }),
}));

import { POST, GET } from './route';

const SECRET = 'a'.repeat(64);

function config(): FakeConfig {
  return {
    account_id: 'acc-1',
    instance_name: 'Atendimento01',
    webhook_secret: SECRET,
    instance_settings: {
      alwaysOnline: false,
      readMessages: false,
      rejectCall: true,
      msgCall: '',
      groupsIgnore: true,
      saveMedia: true,
      webhook: { enabled: true, url: '', headers: {}, events: [], base64: false },
    },
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.test/api/whatsmiau/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function textEvent() {
  return {
    event: 'messages.upsert',
    instance: 'Atendimento01',
    data: {
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_001', fromMe: false },
      pushName: 'Cliente',
      message: { conversation: 'Olá' },
      messageType: 'conversation',
      messageTimestamp: 1793113200,
    },
  };
}

async function drain() {
  while (h.afterCallbacks.length > 0) {
    const cb = h.afterCallbacks.shift()!;
    await cb();
  }
}

describe('POST /api/whatsmiau/webhook', () => {
  beforeEach(() => {
    h.afterCallbacks.length = 0;
    h.inbound.length = 0;
    h.status.length = 0;
    h.connection.length = 0;
    h.edited.length = 0;
    h.deleted.length = 0;
    h.config = config();
  });

  it('answers 401 when the Authorization header is missing', async () => {
    const res = await POST(request(textEvent()));
    expect(res.status).toBe(401);
  });

  it('answers 401 when the secret does not match', async () => {
    const res = await POST(request(textEvent(), { authorization: 'Bearer nope' }));
    expect(res.status).toBe(401);
  });

  it('answers 404 for an instance we do not know', async () => {
    // The secret is valid, but the envelope names another instance.
    h.config = { ...config(), instance_name: 'OutraInstancia' };
    const res = await POST(request(textEvent(), { authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(404);
  });

  it('answers 400 for a body that is not a WhatsMiau envelope', async () => {
    const res = await POST(
      request({ nope: true }, { authorization: `Bearer ${SECRET}` }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts the event and processes it inside after()', async () => {
    const res = await POST(
      request(textEvent(), { authorization: `Bearer ${SECRET}` }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'received' });

    expect(h.inbound).toHaveLength(0);
    await drain();
    expect(h.inbound).toHaveLength(1);
  });

  it('maps DELIVERY_ACK to delivered and READ to read', async () => {
    await POST(
      request(
        {
          event: 'messages.update',
          instance: 'Atendimento01',
          data: { messageId: 'MSG_001', status: 'DELIVERY_ACK' },
        },
        { authorization: `Bearer ${SECRET}` },
      ),
    );
    await drain();
    expect(h.status).toEqual([{ messageId: 'MSG_001', status: 'delivered' }]);

    await POST(
      request(
        {
          event: 'messages.update',
          instance: 'Atendimento01',
          data: { messageId: 'MSG_002', status: 'READ' },
        },
        { authorization: `Bearer ${SECRET}` },
      ),
    );
    await drain();
    expect(h.status[1]).toEqual({ messageId: 'MSG_002', status: 'read' });
  });

  it('routes connection.update to the connection handler', async () => {
    await POST(
      request(
        {
          event: 'connection.update',
          instance: 'Atendimento01',
          data: { state: 'open', wuid: '5511999988888@s.whatsapp.net', statusReason: 200 },
        },
        { authorization: `Bearer ${SECRET}` },
      ),
    );
    await drain();
    expect(h.connection).toHaveLength(1);
    expect(h.connection[0]).toMatchObject({ state: 'open' });
  });

  it('ignores an event we do not model', async () => {
    const res = await POST(
      request(
        { event: 'contacts.upsert', instance: 'Atendimento01', data: [] },
        { authorization: `Bearer ${SECRET}` },
      ),
    );
    expect(res.status).toBe(200);
    await drain();
    expect(h.inbound).toHaveLength(0);
  });
});

describe('GET /api/whatsmiau/webhook', () => {
  it('answers 200', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
