import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { WhatsmiauConnection } from '../types';
import {
  connectInstance,
  createInstance,
  deleteInstance,
  getConnectionState,
  getWebhookConfig,
  logoutInstance,
  setWebhook,
  updateInstance,
  validateProviderInstanceName,
} from './instances';

const conn: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'studio_bella_atendimento_01',
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

describe('provider instance name validation', () => {
  it('accepts a valid name', () => {
    expect(validateProviderInstanceName('studio_bella_atendimento_01')).toEqual({ ok: true });
    expect(validateProviderInstanceName('a_b.c-1')).toEqual({ ok: true });
  });

  it('rejects a name longer than 40 characters', () => {
    const result = validateProviderInstanceName('a'.repeat(41));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/40/);
  });

  it('rejects accents and other punctuation', () => {
    expect(validateProviderInstanceName('Atendimentoção').ok).toBe(false);
    expect(validateProviderInstanceName('atendimento 01').ok).toBe(false);
    expect(validateProviderInstanceName('atendimento/01').ok).toBe(false);
  });

  it('rejects a name with no alphanumeric character', () => {
    const result = validateProviderInstanceName('___');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/letter or digit/i);
  });

  it('rejects an empty name', () => {
    expect(validateProviderInstanceName('').ok).toBe(false);
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
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ id: 'studio_bella_atendimento_01' }));
    await createInstance(conn, {
      instanceName: 'studio_bella_atendimento_01',
      settings: {
        alwaysOnline: true,
        readMessages: false,
        rejectCall: true,
        msgCall: '',
        groupsIgnore: true,
        saveMedia: true,
        channelsEnabled: false,
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
    expect(call.body.instanceName).toBe('studio_bella_atendimento_01');
    expect(call.body.alwaysOnline).toBe(true);
    expect(call.body.readMessages).toBe(false);
    expect(call.body.webhook.events).toEqual(['messages.upsert']);
  });

  it('reads the connection state', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ state: 'open', connected: true, wuid: '5511999998888@s.whatsapp.net' }),
    );
    const state = await getConnectionState(conn, 'studio_bella_atendimento_01');
    expect(lastCall().url).toBe(
      'https://api.whatsmiau.dev/v2/instance/connectionState/studio_bella_atendimento_01',
    );
    expect(state.state).toBe('open');
    expect(state.connected).toBe(true);
    expect(state.wuid).toBe('5511999998888@s.whatsapp.net');
  });

  it('reports a suspension', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ state: 'closed', suspended: true, suspension_reason: 'billing_past_due' }),
    );
    const state = await getConnectionState(conn, 'studio_bella_atendimento_01');
    expect(state.suspended).toBe(true);
    expect(state.suspension_reason).toBe('billing_past_due');
  });

  it('returns the QR payload', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ base64: 'iVBORw0KGgo=', pairingCode: '12345678', connected: false }),
    );
    const qr = await connectInstance(conn, 'studio_bella_atendimento_01');
    expect(lastCall().url).toBe(
      'https://api.whatsmiau.dev/v2/instance/connect/studio_bella_atendimento_01',
    );
    expect(qr.base64).toBe('iVBORw0KGgo=');
    expect(qr.pairingCode).toBe('12345678');
    expect(qr.connected).toBe(false);
  });

  it('updates the instance', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await updateInstance(conn, 'studio_bella_atendimento_01', {
      alwaysOnline: true,
      readMessages: true,
      rejectCall: false,
      msgCall: 'nao podemos agora',
      groupsIgnore: false,
      saveMedia: true,
      channelsEnabled: false,
      webhook: {
        enabled: true,
        url: 'https://app.example/api/whatsmiau/webhook',
        headers: {},
        events: ['messages.upsert'],
        base64: false,
      },
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/instance/update/studio_bella_atendimento_01');
    expect(call.method).toBe('PUT');
    expect(call.body.readMessages).toBe(true);
    expect(call.body.msgCall).toBe('nao podemos agora');
  });

  it('sets the webhook', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await setWebhook(conn, 'studio_bella_atendimento_01', {
      enabled: true,
      url: 'https://app.example/api/whatsmiau/webhook',
      headers: { Authorization: 'Bearer secret' },
      events: ['messages.upsert', 'connection.update'],
      base64: false,
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/webhook/set/studio_bella_atendimento_01');
    expect(call.body.webhook.events).toEqual(['messages.upsert', 'connection.update']);
  });

  it('reads the webhook config', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ webhook: { enabled: true, url: 'https://a', events: ['messages.upsert'] } }),
    );
    const config = await getWebhookConfig(conn, 'studio_bella_atendimento_01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/webhook/find/studio_bella_atendimento_01');
    expect(config?.enabled).toBe(true);
  });

  it('logs out and deletes', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await logoutInstance(conn, 'studio_bella_atendimento_01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/instance/logout/studio_bella_atendimento_01');
    expect(lastCall().method).toBe('DELETE');

    await deleteInstance(conn, 'studio_bella_atendimento_01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/instance/delete/studio_bella_atendimento_01');
    expect(lastCall().method).toBe('DELETE');
  });
});
