'use client';

import { useEffect, useState } from 'react';

export type ActiveProvider = 'meta' | 'whatsmiau';

export interface ActiveProviderState {
  provider: ActiveProvider;
  /** The CRMBR (non-official) API has no approved templates. */
  supportsTemplates: boolean;
  loading: boolean;
}

/**
 * Which WhatsApp API this account sends through.
 *
 * The composer uses it to hide the template picker when the CRMBR
 * API is the active provider. The server refuses template sends on
 * that path anyway (`assertProviderSupportsMessageType`) — this hook
 * is the friendly half of the defence, not the only one.
 *
 * A failed request falls back to Meta WITH templates: the server is
 * the one that has to say no, and the app must not lock the user out
 * of a feature because a small request did not answer.
 */
export function useActiveProvider(): ActiveProviderState {
  const [state, setState] = useState<ActiveProviderState>({
    provider: 'meta',
    supportsTemplates: true,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsmiau/active', { cache: 'no-store' })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ provider?: ActiveProvider }>)
          : null,
      )
      .then((body) => {
        if (cancelled) return;
        // A body that does not name a provider is treated as Meta —
        // same fallback as a failed request.
        const provider: ActiveProvider =
          body?.provider === 'whatsmiau' ? 'whatsmiau' : 'meta';
        setState({
          provider,
          supportsTemplates: provider === 'meta',
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ provider: 'meta', supportsTemplates: true, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
