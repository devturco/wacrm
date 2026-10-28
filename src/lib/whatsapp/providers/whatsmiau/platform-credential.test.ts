import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from '../errors';
import {
  DEFAULT_WHATSMIAU_BASE_URL,
  isPlatformConfigured,
  platformCredential,
} from './platform-credential';

describe('platformCredential', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads the key from the environment', () => {
    vi.stubEnv('WHATSMIAU_API_KEY', '  platform-key  ');
    const credential = platformCredential();
    expect(credential.apiKey).toBe('platform-key');
    expect(credential.baseUrl).toBe(DEFAULT_WHATSMIAU_BASE_URL);
  });

  it('reads the base URL from the environment when it is set', () => {
    vi.stubEnv('WHATSMIAU_API_KEY', 'platform-key');
    vi.stubEnv('WHATSMIAU_BASE_URL', 'https://crmbr.example/v2/');
    expect(platformCredential().baseUrl).toBe('https://crmbr.example/v2');
  });

  it('refuses to work without a key — the customer never sees the reason', () => {
    vi.stubEnv('WHATSMIAU_API_KEY', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let thrown: unknown;
    try {
      platformCredential();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderError);
    const error = thrown as ProviderError;
    expect(error.code).toBe('crmbr_not_configured');
    expect(error.status).toBe(503);
    // The message is for the customer: it never names the provider or
    // the environment variable.
    expect(error.message).not.toMatch(/whatsmiau/i);
    expect(error.message).not.toMatch(/WHATSMIAU_API_KEY/);
  });

  it('reports whether the platform credential is configured', () => {
    vi.stubEnv('WHATSMIAU_API_KEY', '');
    expect(isPlatformConfigured()).toBe(false);

    vi.stubEnv('WHATSMIAU_API_KEY', 'platform-key');
    expect(isPlatformConfigured()).toBe(true);
  });
});
