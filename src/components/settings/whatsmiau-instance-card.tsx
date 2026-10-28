'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Download, Loader2, QrCode, RefreshCw, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsChip, StatusDot } from './settings-chip';
import type { WhatsmiauStatus } from '@/lib/whatsapp/providers/whatsmiau/settings';

/** How often we ask the provider whether the phone confirmed the pairing. */
const POLL_INTERVAL_MS = 3000;

interface QrState {
  base64: string;
  pairing_code?: string;
  connected: boolean;
}

/** The provider hands back raw base64; the browser needs a data URL. */
function qrSrc(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:image/png;base64,${base64}`;
}

/**
 * Linking the phone to the instance: the QR code, the pairing code and
 * the reconnect button. It mirrors the WhatsMiau panel's own
 * "Configurações" screen, because that is the mental model the user
 * already has.
 */
export function WhatsmiauInstanceCard({
  instanceName,
  status,
  phoneNumber,
  onChanged,
}: {
  instanceName: string | null;
  status: WhatsmiauStatus;
  phoneNumber: string | null;
  onChanged: () => void;
}) {
  const t = useTranslations('Settings.whatsmiau');
  const [qr, setQr] = useState<QrState | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
            onChanged();
            toast.success(t('paired'));
          }
        } catch {
          // A transient network error must not kill the poll — the user
          // is scanning a QR code and expects the screen to keep
          // trying.
        }
      }, POLL_INTERVAL_MS);
    },
    [onChanged, stopPolling, t],
  );

  async function fetchQr() {
    if (!instanceName) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(instanceName)}/connect`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('qrFailed'));
        return;
      }
      setQr(data);
      if (!data.connected) startPolling(instanceName);
    } catch {
      toast.error(t('qrFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleReconnect() {
    if (!instanceName) return;
    setReconnecting(true);
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(instanceName)}/connect`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('reconnectFailed'));
        return;
      }
      setQr(data);
      startPolling(instanceName);
    } catch {
      toast.error(t('reconnectFailed'));
    } finally {
      setReconnecting(false);
    }
  }

  function handleDownloadQr() {
    if (!qr) return;
    const link = document.createElement('a');
    link.href = qrSrc(qr.base64);
    link.download = `whatsmiau-${instanceName ?? 'qr'}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (!instanceName) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Smartphone className="size-4 text-primary" />
              {t('numberTitle')}
            </CardTitle>
            <CardDescription className="mt-1 text-muted-foreground">
              {t('numberDesc')}
            </CardDescription>
          </div>
          <SettingsChip
            variant={
              status === 'connected'
                ? 'ok'
                : status === 'error'
                  ? 'warn'
                  : 'muted'
            }
          >
            {status === 'connected' ? (
              <>
                <StatusDot /> {t('connected')}
              </>
            ) : status === 'connecting' ? (
              t('connecting')
            ) : status === 'error' ? (
              t('error')
            ) : (
              t('disconnected')
            )}
          </SettingsChip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'connected' && phoneNumber ? (
          <p className="text-sm text-muted-foreground">
            {t('linkedNumber')}{' '}
            <span className="font-medium text-foreground">{phoneNumber}</span>
          </p>
        ) : null}

        {qr ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-xl border border-border bg-white p-2">
              {/* The provider hands us a data URL — next/image would
                  add nothing here and would need the remote loader. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrSrc(qr.base64)}
                alt={t('qrAlt')}
                className="size-40 rounded-lg"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {qr.pairing_code ? (
                <div className="space-y-1.5">
                  <Label
                    className="text-muted-foreground"
                    htmlFor="whatsmiau-pairing-code"
                  >
                    {t('pairingCode')}
                  </Label>
                  <Input
                    id="whatsmiau-pairing-code"
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
                variant="outline"
                size="sm"
                onClick={handleDownloadQr}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Download className="size-3.5" />
                {t('shareQr')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={fetchQr}
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <QrCode className="size-4" />
              )}
              {status === 'connected' ? t('showQr') : t('generateQr')}
            </Button>
            {status === 'connected' ? (
              <Button
                variant="outline"
                onClick={handleReconnect}
                disabled={reconnecting}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {reconnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t('reconnect')}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
