import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { WhatsmiauConnection } from '../types';
import { ProviderError } from '../errors';
import {
  whatsmiauSendButtons,
  whatsmiauSendList,
  whatsmiauSendMedia,
  whatsmiauSendPresence,
  whatsmiauSendReaction,
  whatsmiauSendText,
} from './api';
import { whatsmiauSendTemplate, whatsmiauSendTyping } from './adapter';

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
  return { url: url as string, body: init.body ? JSON.parse(init.body) : undefined };
}

describe('whatsmiau adapter — outbound shapes', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends text to /message/sendText with digits-only number', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ key: { id: 'MSG_1' } }),
    );
    const result = await whatsmiauSendText(conn, { to: '+55 (11) 99999-8888', text: 'oi' });
    const call = lastCall();
    expect(call.url).toBe(
      'https://api.whatsmiau.dev/v2/message/sendText/Atendimento01',
    );
    expect(call.body).toEqual({ number: '5511999998888', text: 'oi' });
    expect(result.messageId).toBe('MSG_1');
  });

  it('quotes a message when a context id is given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendText(conn, { to: '5511999998888', text: 'oi', contextMessageId: 'OLD' });
    expect(lastCall().body.quoted).toEqual({ key: { id: 'OLD' } });
  });

  it('sends image/video/document through /message/sendMedia', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendMedia(conn, {
      to: '5511999998888',
      kind: 'document',
      link: 'https://cdn.example/a.pdf',
      caption: 'contrato',
      filename: 'a.pdf',
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/message/sendMedia/Atendimento01');
    expect(call.body).toEqual({
      number: '5511999998888',
      mediatype: 'document',
      media: 'https://cdn.example/a.pdf',
      caption: 'contrato',
      fileName: 'a.pdf',
    });
  });

  it('sends audio through the dedicated audio endpoint', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendMedia(conn, {
      to: '5511999998888',
      kind: 'audio',
      link: 'https://cdn.example/a.ogg',
    });
    const call = lastCall();
    expect(call.url).toBe(
      'https://api.whatsmiau.dev/v2/message/sendWhatsAppAudio/Atendimento01',
    );
    expect(call.body).toEqual({ number: '5511999998888', audio: 'https://cdn.example/a.ogg' });
  });

  it('sends buttons with displayText and id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendButtons(conn, {
      to: '5511999998888',
      bodyText: 'confirma?',
      headerText: 'Cabeçalho',
      footerText: 'rodapé',
      buttons: [{ id: 'sim', title: 'Sim' }],
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/message/sendButtons/Atendimento01');
    expect(call.body).toEqual({
      number: '5511999998888',
      title: 'Cabeçalho',
      description: 'confirma?',
      footer: 'rodapé',
      buttons: [{ type: 'reply', displayText: 'Sim', id: 'sim' }],
    });
  });

  it('sends a list with rowId', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendList(conn, {
      to: '5511999998888',
      bodyText: 'escolha',
      buttonLabel: 'Abrir',
      sections: [
        { title: 'Setor', rows: [{ id: 'suporte', title: 'Suporte', description: 'time 1' }] },
      ],
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/message/sendList/Atendimento01');
    expect(call.body.sections[0].rows[0].rowId).toBe('suporte');
    expect(call.body.buttonText).toBe('Abrir');
  });

  it('sends a reaction with a normalized jid', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendReaction(conn, {
      to: '5511999998888',
      targetMessageId: 'MSG_1',
      emoji: '👍',
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/message/sendReaction/Atendimento01');
    expect(call.body).toEqual({
      reaction: '👍',
      key: {
        remoteJid: '5511999998888@s.whatsapp.net',
        id: 'MSG_1',
        fromMe: false,
      },
    });
  });

  it('sends the presence as composing', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await whatsmiauSendPresence(conn, { to: '5511999998888' });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/chat/sendPresence/Atendimento01');
    expect(call.body).toEqual({
      number: '5511999998888',
      presence: 'composing',
      type: 'text',
    });
  });

  it('throws when the provider answers without a message id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await expect(
      whatsmiauSendText(conn, { to: '5511999998888', text: 'oi' }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('whatsmiau adapter — unsupported capabilities', () => {
  it('refuses to send a template', async () => {
    await expect(
      whatsmiauSendTemplate(conn, {
        to: '5511999998888',
        templateName: 'hello',
      }),
    ).rejects.toBeInstanceOf(ProviderError);
    await whatsmiauSendTemplate(conn, {
      to: '5511999998888',
      templateName: 'hello',
    }).catch((e: ProviderError) => {
      expect(e.code).toBe('template_unsupported');
      expect(e.status).toBe(400);
    });
  });

  it('ignores the inbound message id when typing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await whatsmiauSendTyping(conn, { to: '5511999998888', messageId: 'IN' });
    expect(lastCall().url).toBe(
      'https://api.whatsmiau.dev/v2/chat/sendPresence/Atendimento01',
    );
    vi.unstubAllGlobals();
  });
});
