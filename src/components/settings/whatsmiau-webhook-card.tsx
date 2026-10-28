'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Copy, Lock, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { WEBHOOK_EVENT_SAMPLES } from '@/lib/whatsapp/providers/whatsmiau/event-samples';
import { SUPPORTED_WEBHOOK_EVENTS } from '@/lib/whatsapp/providers/whatsmiau/webhook';
import {
  LOCKED_WEBHOOK_HEADER,
  type WhatsmiauWebhookConfig,
} from '@/lib/whatsapp/providers/whatsmiau/settings';

/** The provider caps the custom headers at 20. */
const MAX_HEADERS = 20;

/**
 * The webhook configuration — the same blocks the WhatsMiau panel
 * shows: the integration type, the URL, the custom headers and the
 * event grid.
 *
 * The `Authorization` header is OURS: it carries the account's
 * webhook secret, which the browser must never see. It is rendered
 * as a locked row, and the server rebuilds it on every push.
 */
export function WhatsmiauWebhookCard({
  value,
  onChange,
  publicUrl,
  disabled = false,
}: {
  value: WhatsmiauWebhookConfig;
  onChange: (next: WhatsmiauWebhookConfig) => void;
  /**
   * The public URL of this app + the webhook route.
   *
   * It is derived from the CURRENT origin, never from the stored
   * row: a URL baked into the database would be wrong the day the app
   * moves to another host. The server rebuilds the same URL on every
   * push (`webhookUrlFor(request)`), so what the user copies here is
   * exactly what the provider receives.
   */
  publicUrl: string;
  disabled?: boolean;
}) {
  const t = useTranslations('Settings.whatsmiau.webhook');
  const [sampleEvent, setSampleEvent] = useState<string | null>(null);

  const headers = Object.entries(value.headers ?? {});

  function setHeader(index: number, key: string, headerValue: string) {
    const next = [...headers];
    next[index] = [key, headerValue];
    onChange({ ...value, headers: Object.fromEntries(next) });
  }

  function addHeader() {
    if (headers.length >= MAX_HEADERS) {
      toast.error(t('maxHeaders', { count: MAX_HEADERS }));
      return;
    }
    let n = 1;
    let key = `X-Custom-${n}`;
    while (Object.prototype.hasOwnProperty.call(value.headers ?? {}, key)) {
      n += 1;
      key = `X-Custom-${n}`;
    }
    onChange({ ...value, headers: { ...(value.headers ?? {}), [key]: '' } });
  }

  function removeHeader(key: string) {
    const next = { ...(value.headers ?? {}) };
    delete next[key];
    onChange({ ...value, headers: next });
  }

  function toggleEvent(event: string) {
    const events = value.events.includes(event)
      ? value.events.filter((e) => e !== event)
      : [...value.events, event];
    onChange({ ...value, events });
  }

  function copyUrl() {
    navigator.clipboard.writeText(publicUrl);
    toast.success(t('copied'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">{t('title')}</CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Integration type — fixed by the provider */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {t('integrationType')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('integrationTypeHint')}
            </p>
          </div>
          <Badge variant="outline">{t('evolutionApi')}</Badge>
        </div>

        {/* Webhook URL */}
        <div className="space-y-2">
          <Label className="text-muted-foreground" htmlFor="whatsmiau-webhook-url">
            {t('url')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="whatsmiau-webhook-url"
              readOnly
              value={publicUrl}
              disabled={disabled}
              className="bg-muted border-border font-mono text-sm text-muted-foreground"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyUrl}
              disabled={disabled || !publicUrl}
              aria-label={t('copyUrl')}
              className="shrink-0 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>

        {/* Headers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t('headers')}</p>
              <p className="text-xs text-muted-foreground">{t('headersHint')}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addHeader}
              disabled={disabled || headers.length >= MAX_HEADERS}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-3.5" />
              {t('addHeader')}
            </Button>
          </div>

          {/* The locked header — ours, never editable, never revealed */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
            <Lock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">
              {LOCKED_WEBHOOK_HEADER}
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              Bearer ••••••••••••••••
            </span>
          </div>

          {headers.map(([key, headerValue], index) => (
            <div key={`${key}-${index}`} className="flex gap-2">
              <Input
                value={key}
                onChange={(e) => setHeader(index, e.target.value, headerValue)}
                disabled={disabled}
                placeholder={t('headerName')}
                aria-label={t('headerName')}
                className="bg-muted border-border text-foreground"
              />
              <Input
                value={headerValue}
                onChange={(e) => setHeader(index, key, e.target.value)}
                disabled={disabled}
                placeholder={t('headerValue')}
                aria-label={t('headerValue')}
                className="bg-muted border-border text-foreground"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => removeHeader(key)}
                disabled={disabled}
                aria-label={t('removeHeader')}
                className="shrink-0 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {/* Events */}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t('events')}</p>
            <p className="text-xs text-muted-foreground">{t('eventsHint')}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUPPORTED_WEBHOOK_EVENTS.map((event) => {
              const checked = value.events.includes(event);
              return (
                <div
                  key={event}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleEvent(event)}
                    disabled={disabled}
                    aria-label={event}
                  />
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {event}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setSampleEvent(event)}
                    className="ml-auto text-xs text-primary transition-colors hover:underline"
                  >
                    {t('viewSample')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Provider-side webhook switches */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t('enabled')}</p>
              <p className="text-xs text-muted-foreground">{t('enabledDesc')}</p>
            </div>
            <Switch
              checked={value.enabled}
              onCheckedChange={(next) => onChange({ ...value, enabled: next })}
              disabled={disabled}
              aria-label={t('enabled')}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t('base64')}</p>
              <p className="text-xs text-muted-foreground">{t('base64Desc')}</p>
            </div>
            <Switch
              checked={value.base64}
              onCheckedChange={(next) => onChange({ ...value, base64: next })}
              disabled={disabled}
              aria-label={t('base64')}
            />
          </div>
        </div>
      </CardContent>

      <Dialog
        open={sampleEvent !== null}
        onOpenChange={(open) => {
          if (!open) setSampleEvent(null);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-popover-foreground">
              {sampleEvent}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('sampleDescription')}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs leading-relaxed text-foreground">
            {sampleEvent ? (WEBHOOK_EVENT_SAMPLES[sampleEvent] ?? '') : ''}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSampleEvent(null)}
              className="border-border text-muted-foreground"
            >
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
