import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { WhatsmiauConnection } from '../types';
import {
  connectInstance,
  createInstance,
  deleteInstance,
  getConnectionState,
  getWebhookConfig,
  listInstances,
  logoutInstance,
  setWebhook,
  updateInstance,
  validateInstanceName,
} from './instances';

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

function lastCall() {
  const mock = fetch as ReturnType<typeof vi.fn>;
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1];
  return { url: url as string, method: init.method as string, body: init.body ? JSON.parse(init.body) : undefined };
}

describe('instance name validation', () => {
  it('accepts a valid name', () => {
    expect(validateInstanceName('Atendimento01')).toEqual({ ok: true });
    expect(validateInstanceName('a_b.c-1')).toEqual({ ok: true });
  });

  it('rejects a name longer than 40 characters', () => {
    const result = validateInstanceName('a'.repeat(41));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/40/);
  });

  it('rejects accents and other punctuation', () => {
    expect(validateInstanceName('Atendimentoção').ok).toBe(false);
    expect(validateInstanceName('atendimento 01').ok).toBe(false);
    expect(validateInstanceName('atendimento/01').ok).toBe(false);
  });

  it('rejects a name with no alphanumeric character', () => {
    const result = validateInstanceName('___');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/letter or digit/i);
  });

  it('rejects an empty name', () => {
    expect(validateInstanceName('').ok).toBe(false);
  });
});

describe('whatsmiau instances — requests', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an instance with the behaviour flags', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ id: 'Atendimento01' }));
    await createInstance(conn, {
      instanceName: 'Atendimento01',
      settings: {
        alwaysOnline: true,
        readMessages: false,
        rejectCall: true,
        msgCall: '',
        groupsIgnore: true,
        saveMedia: true,
        webhook: {
          enabled: true,
          url: 'https://app.example/api/whatsmiau/webhook',
          headers: { Authorization: 'Bearer secret' },
          events: ['messages.upsert'],
          base64: false,
        },
      },
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/instance/create');
    expect(call.method).toBe('POST');
    expect(call.body.instanceName).toBe('Atendimento01');
    expect(call.body.alwaysOnline).toBe(true);
    expect(call.body.readMessages).toBe(false);
    expect(call.body.webhook.events).toEqual(['messages.upsert']);
  });

  it('lists instances', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ name: 'Atendimento01', state: 'open' }]),
    );
    const list = await listInstances(conn);
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/instance/fetchInstances');
    expect(list[0].name).toBe('Atendimento01');
  });

  it('tolerates a non-array fetchInstances payload', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ instances: [] }));
    await expect(listInstances(conn)).resolves.toEqual([]);
  });

  it('reads the connection state', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ state: 'open', connected: true, wuid: '5511999998888@s.whatsapp.net' }),
    );
    const state = await getConnectionState(conn, 'Atendimento01');
    expect(lastCall().url).toBe(
      'https://api.whatsmiau.dev/v2/instance/connectionState/Atendimento01',
    );
    expect(state.state).toBe('open');
    expect(state.connected).toBe(true);
    expect(state.wuid).toBe('5511999998888@s.whatsapp.net');
  });

  it('reports a suspension', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ state: 'closed', suspended: true, suspension_reason: 'billing_past_due' }),
    );
    const state = await getConnectionState(conn, 'Atendimento01');
    expect(state.suspended).toBe(true);
    expect(state.suspension_reason).toBe('billing_past_due');
  });

  it('returns the QR payload', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ base64: 'iVBORw0KGgo=', pairingCode: '12345678', connected: false }),
    );
    const qr = await connectInstance(conn, 'Atendimento01');
    expect(lastCall().url).toBe(
      'https://api.whatsmiau.dev/v2/instance/connect/Atendimento01',
    );
    expect(qr.base64).toBe('iVBORw0KGgo=');
    expect(qr.pairingCode).toBe('12345678');
    expect(qr.connected).toBe(false);
  });

  it('updates the instance', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await updateInstance(conn, 'Atendimento01', {
      alwaysOnline: true,
      readMessages: true,
      rejectCall: false,
      msgCall: 'nao podemos agora',
      groupsIgnore: false,
      saveMedia: true,
      webhook: {
        enabled: true,
        url: 'https://app.example/api/whatsmiau/webhook',
        headers: {},
        events: ['messages.upsert'],
        base64: false,
      },
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/instance/update/Atendimento01');
    expect(call.method).toBe('PUT');
    expect(call.body.readMessages).toBe(true);
    expect(call.body.msgCall).toBe('nao podemos agora');
  });

  it('sets the webhook', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await setWebhook(conn, 'Atendimento01', {
      enabled: true,
      url: 'https://app.example/api/whatsmiau/webhook',
      headers: { Authorization: 'Bearer secret' },
      events: ['messages.upsert', 'connection.update'],
      base64: false,
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/webhook/set/Atendimento01');
    expect(call.body.webhook.events).toEqual(['messages.upsert', 'connection.update']);
  });

  it('reads the webhook config', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ webhook: { enabled: true, url: 'https://a', events: ['messages.upsert'] } }),
    );
    const config = await getWebhookConfig(conn, 'Atendimento01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/webhook/find/Atendimento01');
    expect(config?.enabled).toBe(true);
  });

  it('logs out and deletes', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await logoutInstance(conn, 'Atendimento01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/instance/logout/Atendimento01');
    expect(lastCall().method).toBe('DELETE');

    await deleteInstance(conn, 'Atendimento01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/instance/delete/Atendimento01');
    expect(lastCall().method).toBe('DELETE');
  });
});
