'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** How often we ask the provider whether the phone confirmed the pairing. */
const POLL_INTERVAL_MS = 3000;

export interface QrState {
  base64: string;
  pairing_code?: string;
  connected: boolean;
}

/** The provider hands back raw base64; the browser needs a data URL. */
export function qrSrc(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:image/png;base64,${base64}`;
}

/**
 * Pairing a phone with a connection: the QR code, the pairing code and
 * the watch for the moment the phone confirms.
 *
 * It is shared by the two places that pair a number — the block of an
 * existing connection and the "new connection" modal — so both behave
 * the same way and both stop the watch the same way.
 */
export function useWhatsmiauPairing(
  instanceName: string | null,
  onPaired?: () => void,
) {
  const t = useTranslations('Settings.whatsmiau');
  const [qr, setQr] = useState<QrState | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The instance the QR on screen belongs to — it may differ from the
  // one the hook is bound to (the modal pairs an instance it has just
  // created), and the downloaded file is named after it.
  const targetRef = useRef<string | null>(instanceName);

  // The callback lives in a ref so that a new function identity on
  // every render does not restart the watch.
  const onPairedRef = useRef(onPaired);
  useEffect(() => {
    onPairedRef.current = onPaired;
  }, [onPaired]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // While a QR code is on screen, watch the connection state: the
  // provider flips the instance to `open` the moment the phone
  // confirms the pairing, and that is the moment we refresh the row.
  const startPolling = useCallback(
    (name: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/whatsmiau/instances/${encodeURIComponent(name)}`,
            { cache: 'no-store' },
          );
          if (!res.ok) return;
          const state = await res.json();
          if (state?.state === 'open') {
            stopPolling();
            setQr(null);
            onPairedRef.current?.();
            toast.success(t('paired'));
          }
        } catch {
          // A transient network error must not kill the poll — the user
          // is scanning a QR code and expects the screen to keep
          // trying.
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, t],
  );

  /**
   * Ask the provider for a QR code.
   *
   * The name may be passed explicitly: the "new connection" modal
   * pairs a number it has just created, before the row it belongs to
   * is the one the hook is bound to.
   */
  const generateQr = useCallback(
    async (name?: string) => {
      const target = name ?? instanceName;
      if (!target) return;
      targetRef.current = target;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/whatsmiau/instances/${encodeURIComponent(target)}/connect`,
          { cache: 'no-store' },
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data?.error || t('qrFailed'));
          return;
        }
        setQr(data);
        if (!data.connected) startPolling(target);
      } catch {
        toast.error(t('qrFailed'));
      } finally {
        setLoading(false);
      }
    },
    [instanceName, startPolling, t],
  );

  /**
   * Log the number out and ask for a fresh QR code — the provider only
   * hands out a new one for a session that is not logged in.
   */
  const reconnect = useCallback(
    async (name?: string) => {
      const target = name ?? instanceName;
      if (!target) return;
      targetRef.current = target;
      setReconnecting(true);
      try {
        const res = await fetch(
          `/api/whatsmiau/instances/${encodeURIComponent(target)}/connect`,
          { method: 'POST' },
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data?.error || t('reconnectFailed'));
          return;
        }
        setQr(data);
        startPolling(target);
      } catch {
        toast.error(t('reconnectFailed'));
      } finally {
        setReconnecting(false);
      }
    },
    [instanceName, startPolling, t],
  );

  const downloadQr = useCallback(() => {
    if (!qr) return;
    const link = document.createElement('a');
    link.href = qrSrc(qr.base64);
    link.download = `whatsmiau-${targetRef.current ?? instanceName ?? 'qr'}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [instanceName, qr]);

  return { qr, loading, reconnecting, generateQr, reconnect, downloadQr };
}

/**
 * The QR code itself, with the pairing code beside it.
 *
 * Shown in the "new connection" modal and in the block of an existing
 * connection — the same picture, the same words, in both places.
 */
export function WhatsmiauQrView({
  qr,
  onDownload,
}: {
  qr: QrState;
  onDownload: () => void;
}) {
  const t = useTranslations('Settings.whatsmiau');
  // The pairing code shows up in more than one place at a time (a
  // block per connection, plus the modal), so the id is generated
  // instead of hardcoded — two elements cannot share an id.
  const codeId = useId();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="shrink-0 rounded-xl border border-border bg-white p-2">
        {/* The provider hands us a data URL — next/image would add
            nothing here and would need the remote loader. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrSrc(qr.base64)}
          alt={t('qrAlt')}
          className="size-44 rounded-lg"
        />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {qr.pairing_code ? (
          <div className="space-y-1.5">
            <Label className="text-muted-foreground" htmlFor={codeId}>
              {t('pairingCode')}
            </Label>
            <Input
              id={codeId}
              readOnly
              value={qr.pairing_code}
              className="bg-muted border-border font-mono text-sm tracking-widest"
            />
          </div>
        ) : null}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('waitingForScan')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownload}
          className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Download className="size-3.5" />
          {t('shareQr')}
        </Button>
      </div>
    </div>
  );
}
