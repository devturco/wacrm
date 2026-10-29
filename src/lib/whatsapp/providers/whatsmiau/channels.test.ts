import { describe, expect, it } from 'vitest';

import {
  isChannelJid,
  isGroupJid,
  jidSuffix,
} from './channels';

describe('jidSuffix', () => {
  it('returns the part after the @', () => {
    expect(jidSuffix('5511999988888@s.whatsapp.net')).toBe('s.whatsapp.net');
    expect(jidSuffix('120363025246005890@newsletter')).toBe('newsletter');
  });

  it('is empty when there is no suffix', () => {
    expect(jidSuffix('')).toBe('');
    expect(jidSuffix('5511999988888')).toBe('');
  });

  it('ignores the case and the padding', () => {
    expect(jidSuffix('123@Newsletter')).toBe('newsletter');
    expect(jidSuffix('123@NEWSLETTER ')).toBe('newsletter');
  });
});

describe('isGroupJid', () => {
  it('spots a group', () => {
    expect(isGroupJid('120363000000000000@g.us')).toBe(true);
  });

  it('does not mistake a person or a channel for a group', () => {
    expect(isGroupJid('5511999988888@s.whatsapp.net')).toBe(false);
    expect(isGroupJid('120363025246005890@newsletter')).toBe(false);
  });
});

describe('isChannelJid', () => {
  it('spots a channel', () => {
    expect(isChannelJid('120363025246005890@newsletter')).toBe(true);
  });

  it('spots a status broadcast', () => {
    expect(isChannelJid('status@broadcast')).toBe(true);
  });

  it('spots a suffix we do not know — it is not a person either', () => {
    expect(isChannelJid('12345@something-new')).toBe(true);
  });

  it('does not mistake a person for a channel', () => {
    expect(isChannelJid('5511999988888@s.whatsapp.net')).toBe(false);
  });

  it('does not mistake a group for a channel', () => {
    expect(isChannelJid('120363000000000000@g.us')).toBe(false);
  });

  it('is false for an empty jid', () => {
    expect(isChannelJid('')).toBe(false);
  });
});
