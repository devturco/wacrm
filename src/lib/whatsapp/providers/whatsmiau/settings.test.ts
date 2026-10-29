import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INSTANCE_SETTINGS,
  isSameSettings,
  type WhatsmiauInstanceSettings,
} from './settings';

/** A settings object with every key spelled out, so a test only has to
 *  change the one thing it is about. */
function settings(
  patch: Partial<WhatsmiauInstanceSettings> = {},
): WhatsmiauInstanceSettings {
  return {
    ...DEFAULT_INSTANCE_SETTINGS,
    webhook: { ...DEFAULT_INSTANCE_SETTINGS.webhook },
    ...patch,
  };
}

describe('whatsmiau settings — isSameSettings', () => {
  it('sees two copies of the same settings as equal', () => {
    expect(isSameSettings(settings(), settings())).toBe(true);
  });

  it('ignores the key order (jsonb does not preserve it)', () => {
    const a = settings();
    const b = settings();
    // Same members, different insertion order.
    b.webhook.headers = { 'X-B': '2', 'X-A': '1' };
    a.webhook.headers = { 'X-A': '1', 'X-B': '2' };

    expect(isSameSettings(a, b)).toBe(true);
  });

  it('ignores the order of the events', () => {
    const a = settings();
    const b = settings();
    a.webhook.events = ['messages.upsert', 'connection.update'];
    b.webhook.events = ['connection.update', 'messages.upsert'];

    expect(isSameSettings(a, b)).toBe(true);
  });

  it('spots a different behaviour switch', () => {
    const a = settings();
    const b = settings({ alwaysOnline: true });

    expect(isSameSettings(a, b)).toBe(false);
  });

  it('ships the channels off', () => {
    expect(DEFAULT_INSTANCE_SETTINGS.channelsEnabled).toBe(false);
  });

  it('spots a different channel switch', () => {
    const a = settings();
    const b = settings({ channelsEnabled: true });

    expect(isSameSettings(a, b)).toBe(false);
  });

  it('spots a different event list', () => {
    const a = settings();
    const b = settings();
    b.webhook.events = [...a.webhook.events, 'messages.upsert.reaction'];

    expect(isSameSettings(a, b)).toBe(false);
  });

  it('spots a different header value', () => {
    const a = settings();
    const b = settings();
    a.webhook.headers = { 'X-Token': 'a' };
    b.webhook.headers = { 'X-Token': 'b' };

    expect(isSameSettings(a, b)).toBe(false);
  });

  it('spots an extra header', () => {
    const a = settings();
    const b = settings();
    b.webhook.headers = { 'X-Token': 'a' };

    expect(isSameSettings(a, b)).toBe(false);
  });

  it('spots a different webhook url', () => {
    const a = settings();
    const b = settings();
    b.webhook.url = 'https://crm.example.com/api/whatsmiau/webhook';

    expect(isSameSettings(a, b)).toBe(false);
  });
});
