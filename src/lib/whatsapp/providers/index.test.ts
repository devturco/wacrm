import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ProviderError } from './errors';
import type { MetaConnection, WhatsmiauConnection } from './types';
import {
  sendTemplateMessage,
  sendTextMessage,
  sendTypingIndicator,
} from './index';

const h = vi.hoisted(() => ({
  metaSendText: vi.fn(),
  metaSendTyping: vi.fn(),
  whatsmiauSendText: vi.fn(),
  whatsmiauSendTyping: vi.fn(),
  whatsmiauSendTemplate: vi.fn(),
}));

vi.mock('./meta/adapter', () => ({
  metaSendText: h.metaSendText,
  metaSendMedia: vi.fn(),
  metaSendTemplate: vi.fn(),
  metaSendButtons: vi.fn(),
  metaSendList: vi.fn(),
  metaSendReaction: vi.fn(),
  metaSendTyping: h.metaSendTyping,
}));

vi.mock('./whatsmiau/adapter', () => ({
  whatsmiauSendText: h.whatsmiauSendText,
  whatsmiauSendMedia: vi.fn(),
  whatsmiauSendTemplate: h.whatsmiauSendTemplate,
  whatsmiauSendButtons: vi.fn(),
  whatsmiauSendList: vi.fn(),
  whatsmiauSendReaction: vi.fn(),
  whatsmiauSendTyping: h.whatsmiauSendTyping,
}));

const metaConn: MetaConnection = {
  provider: 'meta',
  phoneNumberId: 'pn-1',
  accessToken: 'tok-1',
};
const wmConn: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'Atendimento01',
  apiKey: 'key-1',
  baseUrl: 'https://api.whatsmiau.dev/v2',
};

describe('provider dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.metaSendText.mockResolvedValue({ messageId: 'wamid-1' });
    h.whatsmiauSendText.mockResolvedValue({ messageId: 'MSG_1' });
    h.metaSendTyping.mockResolvedValue(undefined);
    h.whatsmiauSendTyping.mockResolvedValue(undefined);
  });

  it('routes text to the Meta adapter for a Meta connection', async () => {
    const result = await sendTextMessage(metaConn, { to: '5511999998888', text: 'oi' });
    expect(h.metaSendText).toHaveBeenCalledWith(metaConn, { to: '5511999998888', text: 'oi' });
    expect(h.whatsmiauSendText).not.toHaveBeenCalled();
    expect(result.messageId).toBe('wamid-1');
  });

  it('routes text to the WhatsMiau adapter for a CRMBR connection', async () => {
    const result = await sendTextMessage(wmConn, { to: '5511999998888', text: 'oi' });
    expect(h.whatsmiauSendText).toHaveBeenCalledWith(wmConn, { to: '5511999998888', text: 'oi' });
    expect(h.metaSendText).not.toHaveBeenCalled();
    expect(result.messageId).toBe('MSG_1');
  });

  it('routes the typing indicator by provider', async () => {
    await sendTypingIndicator(metaConn, { to: '5511999998888', messageId: 'IN' });
    expect(h.metaSendTyping).toHaveBeenCalled();
    await sendTypingIndicator(wmConn, { to: '5511999998888' });
    expect(h.whatsmiauSendTyping).toHaveBeenCalled();
  });

  it('refuses a template on the CRMBR provider', async () => {
    h.whatsmiauSendTemplate.mockRejectedValue(
      new ProviderError('template_unsupported', 'no templates', 400),
    );
    await expect(
      sendTemplateMessage(wmConn, { to: '5511999998888', templateName: 'hello' }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
