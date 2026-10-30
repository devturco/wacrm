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
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.crmbr.com');
    expect(webhookUrlFor(request('http://localhost:3000'))).toBe(
      'https://app.crmbr.com/api/whatsmiau/webhook',
    );
  });

  it('keeps the request origin even when another address is configured', () => {
    // The address that serves the app is right by construction — a
    // stale value in the environment must never point the webhook at
    // the wrong host.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.crmbr.com');
    expect(webhookUrlFor(request('https://app.test'))).toBe(
      'https://app.test/api/whatsmiau/webhook',
    );
  });

  it('strips the trailing slashes of the configured address', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.crmbr.com/');
    expect(webhookUrlFor(request('http://localhost:3000'))).toBe(
      'https://app.crmbr.com/api/whatsmiau/webhook',
    );
  });

  it('uses the address the proxy announces when the request one is internal', () => {
    // Behind a proxy the framework sees an internal `http://`
    // address; the proxy headers name the address the customer uses.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const forwarded = new Request('http://10.0.0.7:3000/api/whatsmiau/instances', {
      method: 'POST',
      headers: {
        'x-forwarded-host': 'app.crmbr.com',
        'x-forwarded-proto': 'https',
      },
    });
    expect(webhookUrlFor(forwarded)).toBe(
      'https://app.crmbr.com/api/whatsmiau/webhook',
    );
  });

  it('never falls back to an address the provider cannot reach', () => {
    // The template placeholder does not resolve: the provider would
    // answer "no such host" to every delivery.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    expect(webhookUrlFor(request('http://localhost:3000'))).toBe(
      'http://localhost:3000/api/whatsmiau/webhook',
    );
  });
});

describe('isReachableWebhookUrl', () => {
  it('accepts a public HTTPS address', () => {
    expect(isReachableWebhookUrl('https://app.crmbr.com/api/whatsmiau/webhook')).toBe(true);
    expect(isReachableWebhookUrl('https://abc.ngrok-free.app/api/whatsmiau/webhook')).toBe(
      true,
    );
  });

  it('refuses a documentation placeholder — it does not even resolve', () => {
    // This is the address a template carries. Pushed as the webhook
    // address, the provider answers "no such host" to every delivery
    // and the inbox stays empty with nothing to explain it.
    expect(isReachableWebhookUrl('https://crm.example.com/api/whatsmiau/webhook')).toBe(false);
    expect(isReachableWebhookUrl('https://example.com/api/whatsmiau/webhook')).toBe(false);
    expect(isReachableWebhookUrl('https://app.example/api/whatsmiau/webhook')).toBe(false);
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
