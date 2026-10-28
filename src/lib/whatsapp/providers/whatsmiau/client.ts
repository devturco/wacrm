// ============================================================
// WhatsMiau HTTP client.
//
// The api key travels in the `apikey` header (the provider's
// documented convention). `baseUrl` is configurable so a self-hosted
// deployment works without a code change.
//
// Every failure is normalised into a WhatsmiauApiError carrying the
// HTTP status, a machine code and the raw payload — the UI shows the
// code, the logs keep the payload.
// ============================================================

import type { WhatsmiauConnection } from '../types';

export class WhatsmiauApiError extends Error {
  /** The status the app should answer with (upstream status mapped). */
  readonly status: number;
  /**
   * The status the provider actually returned — 0 when the request
   * never reached it. `status` is the mapped one (a 423 becomes a 409,
   * a 500 becomes a 502); this keeps the provider's own number, which
   * is what the diagnostics report as `provider_status`.
   */
  readonly upstreamStatus: number;
  readonly code: string;
  readonly raw?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    raw?: unknown,
    upstreamStatus: number = status,
  ) {
    super(message);
    this.name = 'WhatsmiauApiError';
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.code = code;
    this.raw = raw;
  }
}

export interface WhatsmiauRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path relative to the base URL, e.g. `/message/sendText/:instance`. */
  path: string;
  body?: unknown;
}

/**
 * Map an upstream HTTP status onto our machine code + the status the
 * app should answer with.
 */
export function mapWhatsmiauStatus(status: number): { code: string; httpStatus: number } {
  if (status === 400) {
    return { code: 'whatsmiau_invalid_request', httpStatus: 400 };
  }
  if (status === 401 || status === 403) {
    return { code: 'whatsmiau_unauthorized', httpStatus: 401 };
  }
  if (status === 404) {
    return { code: 'whatsmiau_not_found', httpStatus: 404 };
  }
  if (status === 409) {
    return { code: 'whatsmiau_conflict', httpStatus: 409 };
  }
  if (status === 423) {
    return { code: 'whatsmiau_suspended', httpStatus: 409 };
  }
  return { code: 'whatsmiau_error', httpStatus: 502 };
}

/**
 * Pull a human message and a code out of an error payload. The
 * provider's error shape isn't documented in detail, so several
 * plausible shapes are probed and a generic message is the fallback.
 */
function describeFailure(payload: unknown): { code: string; message: string } {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const suspension = typeof record.suspension_reason === 'string' ? record.suspension_reason : null;

    let message = '';
    if (typeof record.message === 'string') message = record.message;
    else if (typeof record.error === 'string') message = record.error;
    else if (Array.isArray(record.errors) && record.errors.length > 0) {
      const first = record.errors[0];
      if (first && typeof first === 'object') {
        const inner = first as Record<string, unknown>;
        message = typeof inner.message === 'string' ? inner.message : '';
      }
    }

    if (suspension) {
      return {
        code: 'whatsmiau_suspended',
        message: `The WhatsMiau instance is suspended (${suspension}). ${message}`.trim(),
      };
    }
    if (typeof record.code === 'string' && record.code) {
      return { code: record.code, message: message || 'WhatsMiau API request failed' };
    }
    return { code: 'whatsmiau_error', message: message || 'WhatsMiau API request failed' };
  }
  return { code: 'whatsmiau_error', message: 'WhatsMiau API request failed' };
}

export async function whatsmiauRequest<T = unknown>(
  conn: WhatsmiauConnection,
  options: WhatsmiauRequestOptions,
): Promise<T> {
  const { method = 'GET', path, body } = options;
  const base = conn.baseUrl.replace(/\/+$/, '');
  const url = `${base}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: conn.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new WhatsmiauApiError(
      0,
      'whatsmiau_network',
      `Could not reach WhatsMiau: ${err instanceof Error ? err.message : 'network error'}`,
    );
  }

  const rawText = await response.text();
  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }
  }

  if (!response.ok) {
    const { code, httpStatus } = mapWhatsmiauStatus(response.status);
    const described = describeFailure(parsed);
    // The error carries the status the APP answers with, not the raw
    // upstream one (a 423 becomes a 409, a 500 becomes a 502). The
    // provider's own status stays available as `upstreamStatus`, and
    // the upstream payload is kept in `raw` for the logs.
    throw new WhatsmiauApiError(
      httpStatus,
      code === 'whatsmiau_error' ? described.code : code,
      described.message,
      parsed,
      response.status,
    );
  }

  return parsed as T;
}
