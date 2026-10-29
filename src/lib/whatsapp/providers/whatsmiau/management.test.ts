import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isReachableWebhookUrl,
  webhookUrlFor,
  withoutLockedHeaders,
} from './management';

function request(origin: string) {
  return new Request(`${origin}/api/whatsmiau/instances`, { method: 'POST' });
}

describe('webhookUrlFor', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the origin that served the request when it is publicly reachable', () => {
    expect(webhookUrlFor(request('https://app.test'))).toBe(
      'https://app.test/api/whatsmiau/webhook',
    );
  });

  it('falls back to the canonical public address when the request one is a development address', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    expect(webhookUrlFor(request('http://localhost:3000'))).toBe(
      'https://crm.example.com/api/whatsmiau/webhook',
    );
  });

  it('keeps the request origin even when another address is configured', () => {
    // The address that serves the app is right by construction — a
    // stale value in the environment must never point the webhook at
    // the wrong host.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    expect(webhookUrlFor(request('https://app.test'))).toBe(
      'https://app.test/api/whatsmiau/webhook',
    );
  });

  it('strips the trailing slashes of the configured address', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/');
    expect(webhookUrlFor(request('http://localhost:3000'))).toBe(
      'https://crm.example.com/api/whatsmiau/webhook',
    );
  });
});

describe('isReachableWebhookUrl', () => {
  it('accepts a public HTTPS address', () => {
    expect(isReachableWebhookUrl('https://crm.example.com/api/whatsmiau/webhook')).toBe(true);
    expect(isReachableWebhookUrl('https://abc.ngrok-free.app/api/whatsmiau/webhook')).toBe(
      true,
    );
  });

  it('refuses a development address — the provider can never reach it', () => {
    expect(isReachableWebhookUrl('http://localhost:3000/api/whatsmiau/webhook')).toBe(false);
    expect(isReachableWebhookUrl('https://localhost:3000/api/whatsmiau/webhook')).toBe(false);
    expect(isReachableWebhookUrl('https://127.0.0.1/api/whatsmiau/webhook')).toBe(false);
    expect(isReachableWebhookUrl('http://0.0.0.0:3000/api/whatsmiau/webhook')).toBe(false);
    expect(isReachableWebhookUrl('https://app.localhost/api/whatsmiau/webhook')).toBe(false);
    expect(isReachableWebhookUrl('https://crmbr.local/api/whatsmiau/webhook')).toBe(false);
  });

  it('refuses a plain HTTP address — the provider requires HTTPS', () => {
    expect(isReachableWebhookUrl('http://crm.example.com/api/whatsmiau/webhook')).toBe(false);
  });

  it('refuses an address it cannot even parse', () => {
    expect(isReachableWebhookUrl('not a url')).toBe(false);
  });
});

describe('withoutLockedHeaders', () => {
  it('drops the locked header whatever its case', () => {
    expect(
      withoutLockedHeaders({ Authorization: 'Bearer secret', 'X-Custom': 'ok' }),
    ).toEqual({ 'X-Custom': 'ok' });
    expect(
      withoutLockedHeaders({ authorization: 'Bearer secret', 'X-Custom': 'ok' }),
    ).toEqual({ 'X-Custom': 'ok' });
  });

  it('survives an empty or missing map', () => {
    expect(withoutLockedHeaders(undefined)).toEqual({});
    expect(withoutLockedHeaders(null)).toEqual({});
  });
});
