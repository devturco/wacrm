import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { MetaConnection } from '../types';
import {
  metaSendButtons,
  metaSendList,
  metaSendMedia,
  metaSendReaction,
  metaSendTemplate,
  metaSendText,
  metaSendTyping,
} from './adapter';

const h = vi.hoisted(() => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
  sendReactionMessage: vi.fn(),
  sendTypingIndicator: vi.fn(),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: h.sendTextMessage,
  sendMediaMessage: h.sendMediaMessage,
  sendTemplateMessage: h.sendTemplateMessage,
  sendInteractiveButtons: h.sendInteractiveButtons,
  sendInteractiveList: h.sendInteractiveList,
  sendReactionMessage: h.sendReactionMessage,
  sendTypingIndicator: h.sendTypingIndicator,
}));

const conn: MetaConnection = {
  provider: 'meta',
  phoneNumberId: 'pn-1',
  accessToken: 'tok-1',
};

describe('meta adapter — delegates to meta-api', () => {
  beforeEach(() => {
    h.sendTextMessage.mockResolvedValue({ messageId: 'wamid-1' });
    h.sendMediaMessage.mockResolvedValue({ messageId: 'wamid-2' });
    h.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid-3' });
    h.sendInteractiveButtons.mockResolvedValue({ messageId: 'wamid-4' });
    h.sendInteractiveList.mockResolvedValue({ messageId: 'wamid-5' });
    h.sendReactionMessage.mockResolvedValue({ messageId: 'wamid-6' });
    h.sendTypingIndicator.mockResolvedValue(undefined);
  });

  it('sends text with the connection credentials', async () => {
    const result = await metaSendText(conn, { to: '5511999998888', text: 'oi' });
    expect(h.sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
      to: '5511999998888',
      text: 'oi',
      contextMessageId: undefined,
    });
    expect(result.messageId).toBe('wamid-1');
  });

  it('sends media with kind, link, caption and filename', async () => {
    await metaSendMedia(conn, {
      to: '5511999998888',
      kind: 'document',
      link: 'https://cdn.example/a.pdf',
      caption: 'olá',
      filename: 'a.pdf',
    });
    expect(h.sendMediaMessage).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
      to: '5511999998888',
      kind: 'document',
      link: 'https://cdn.example/a.pdf',
      caption: 'olá',
      filename: 'a.pdf',
      contextMessageId: undefined,
    });
  });

  it('sends a template', async () => {
    await metaSendTemplate(conn, {
      to: '5511999998888',
      templateName: 'hello',
      language: 'en_US',
      params: ['a'],
    });
    expect(h.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'hello', language: 'en_US', params: ['a'] }),
    );
  });

  it('sends interactive buttons', async () => {
    await metaSendButtons(conn, {
      to: '5511999998888',
      bodyText: 'pick',
      buttons: [{ id: 'a', title: 'A' }],
    });
    expect(h.sendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({ bodyText: 'pick', buttons: [{ id: 'a', title: 'A' }] }),
    );
  });

  it('sends an interactive list', async () => {
    await metaSendList(conn, {
      to: '5511999998888',
      bodyText: 'pick',
      buttonLabel: 'Abrir',
      sections: [{ title: 'S', rows: [{ id: 'r1', title: 'R' }] }],
    });
    expect(h.sendInteractiveList).toHaveBeenCalledWith(
      expect.objectContaining({ buttonLabel: 'Abrir' }),
    );
  });

  it('sends a reaction', async () => {
    await metaSendReaction(conn, {
      to: '5511999998888',
      targetMessageId: 'wamid-0',
      emoji: '👍',
    });
    expect(h.sendReactionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ targetMessageId: 'wamid-0', emoji: '👍' }),
    );
  });

  it('sends the typing indicator with the inbound message id', async () => {
    await metaSendTyping(conn, { to: '5511999998888', messageId: 'wamid-in' });
    expect(h.sendTypingIndicator).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
      messageId: 'wamid-in',
    });
  });
});
