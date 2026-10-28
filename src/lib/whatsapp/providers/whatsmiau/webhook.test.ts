import { describe, expect, it } from 'vitest';

import { isSupportedWebhookEvent, parseWhatsmiauWebhook } from './webhook';
import {
  normalizeConnectionUpdate,
  normalizeDeletedMessage,
  normalizeEditedMessage,
  normalizeInboundMessage,
  normalizeStatusUpdate,
} from './normalize';

describe('parseWhatsmiauWebhook', () => {
  it('parses a valid envelope', () => {
    const parsed = parseWhatsmiauWebhook({
      event: 'messages.upsert',
      instance: 'Atendimento01',
      date_time: '2026-10-27T15:00:00Z',
      data: { key: { id: 'MSG_1' } },
    });
    expect(parsed?.event).toBe('messages.upsert');
    expect(parsed?.instance).toBe('Atendimento01');
    expect(parsed?.data.key).toEqual({ id: 'MSG_1' });
  });

  it('rejects a payload with no event or instance', () => {
    expect(parseWhatsmiauWebhook({ data: {} })).toBeNull();
    expect(parseWhatsmiauWebhook({ event: 'messages.upsert' })).toBeNull();
    expect(parseWhatsmiauWebhook('nope')).toBeNull();
    expect(parseWhatsmiauWebhook(null)).toBeNull();
  });

  it('knows which events we handle', () => {
    expect(isSupportedWebhookEvent('messages.upsert')).toBe(true);
    expect(isSupportedWebhookEvent('messages.update')).toBe(true);
    expect(isSupportedWebhookEvent('connection.update')).toBe(true);
    expect(isSupportedWebhookEvent('group-participants.update')).toBe(false);
    expect(isSupportedWebhookEvent('call')).toBe(false);
  });
});

describe('normalizeInboundMessage', () => {
  it('normalizes a text message', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_1', fromMe: false },
      pushName: 'Cliente',
      message: { conversation: 'Preciso de suporte.' },
      messageType: 'conversation',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('text');
    expect(normalized?.text).toBe('Preciso de suporte.');
    expect(normalized?.phone).toBe('5511999988888');
    expect(normalized?.messageId).toBe('MSG_1');
    expect(normalized?.fromMe).toBe(false);
  });

  it('normalizes an image with its media url and caption', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_2', fromMe: false },
      message: {
        imageMessage: { url: 'https://cdn.example/i.jpg', mimetype: 'image/jpeg', caption: 'olá' },
        mediaUrl: 'https://cdn.example/i.jpg',
      },
      messageType: 'imageMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('image');
    expect(normalized?.mediaUrl).toBe('https://cdn.example/i.jpg');
    expect(normalized?.caption).toBe('olá');
    expect(normalized?.mimeType).toBe('image/jpeg');
  });

  it('normalizes a document with its file name', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_3', fromMe: false },
      message: {
        documentMessage: {
          url: 'https://cdn.example/a.pdf',
          mimetype: 'application/pdf',
          fileName: 'a.pdf',
        },
      },
      messageType: 'documentMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('document');
    expect(normalized?.fileName).toBe('a.pdf');
  });

  it('normalizes a reaction', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_4', fromMe: false },
      message: { reactionMessage: { key: { id: 'MSG_1' }, text: '👍' } },
      messageType: 'reactionMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('reaction');
    expect(normalized?.reactionEmoji).toBe('👍');
    expect(normalized?.reactedToMessageId).toBe('MSG_1');
  });

  it('normalizes a list reply', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_5', fromMe: false },
      message: {
        listResponseMessage: {
          title: 'Suporte',
          singleSelectReply: { selectedRowId: 'suporte' },
        },
      },
      messageType: 'listResponseMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('interactive');
    expect(normalized?.listReplyId).toBe('suporte');
    expect(normalized?.listReplyTitle).toBe('Suporte');
  });

  it('normalizes a button reply', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_6', fromMe: false },
      message: {
        buttonsResponseMessage: {
          selectedButtonId: 'sim',
          selectedDisplayText: 'Sim',
        },
      },
      messageType: 'buttonsResponseMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('interactive');
    expect(normalized?.buttonReplyId).toBe('sim');
    expect(normalized?.buttonReplyTitle).toBe('Sim');
  });

  it('captures the quoted message id', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_7', fromMe: false },
      message: { conversation: 'ok' },
      contextInfo: { stanzaId: 'MSG_1' },
      messageTimestamp: 1793113200,
    });
    expect(normalized?.quotedMessageId).toBe('MSG_1');
  });

  it('returns null without a message id', () => {
    expect(normalizeInboundMessage({ key: { remoteJid: 'x@s.whatsapp.net' } })).toBeNull();
  });
});

describe('normalizeStatusUpdate', () => {
  it('maps DELIVERY_ACK to delivered', () => {
    expect(normalizeStatusUpdate({ messageId: 'MSG_1', status: 'DELIVERY_ACK' })).toEqual({
      messageId: 'MSG_1',
      status: 'delivered',
    });
  });

  it('maps READ to read', () => {
    expect(normalizeStatusUpdate({ messageId: 'MSG_1', status: 'READ' })).toEqual({
      messageId: 'MSG_1',
      status: 'read',
    });
  });

  it('ignores an unknown status', () => {
    expect(normalizeStatusUpdate({ messageId: 'MSG_1', status: 'PENDING' })).toBeNull();
    expect(normalizeStatusUpdate({ status: 'READ' })).toBeNull();
  });
});

describe('normalizeConnectionUpdate', () => {
  it('reads the open state and the wuid', () => {
    const state = normalizeConnectionUpdate({
      instance: 'Atendimento01',
      wuid: '5511999988888@s.whatsapp.net',
      profileName: 'Equipe',
      state: 'open',
      statusReason: 200,
    });
    expect(state?.state).toBe('open');
    expect(state?.wuid).toBe('5511999988888@s.whatsapp.net');
    expect(state?.statusReason).toBe(200);
  });

  it('reads the close state', () => {
    expect(normalizeConnectionUpdate({ state: 'close' })?.state).toBe('close');
  });
});

describe('normalizeDeletedMessage and normalizeEditedMessage', () => {
  it('reads a deletion', () => {
    expect(
      normalizeDeletedMessage({
        id: 'MSG_1',
        remoteJid: '5511999988888@s.whatsapp.net',
        fromMe: false,
      }),
    ).toEqual({ messageId: 'MSG_1', remoteJid: '5511999988888@s.whatsapp.net', fromMe: false });
  });

  it('reads an edit', () => {
    expect(
      normalizeEditedMessage({
        key: { id: 'MSG_1' },
        editedMessage: { conversation: 'texto novo' },
      }),
    ).toEqual({ messageId: 'MSG_1', text: 'texto novo' });
  });
});
