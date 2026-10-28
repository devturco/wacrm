'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  Loader2,
  MessageSquareOff,
  PlugZap,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip, StatusDot } from './settings-chip';

type Provider = 'meta' | 'whatsmiau';

interface MetaState {
  configured: boolean;
  connected: boolean;
}

interface CrmbrState {
  configured: boolean;
  instances: {
    instance_name: string;
    status: string;
    is_active: boolean;
    phone_number?: string | null;
  }[];
}

/**
 * The WhatsApp hub — which API this account is sending through, and
 * the two cards that open each API's own screen.
 *
 * Every card states what the API DOESN'T do, because the two
 * providers are not interchangeable: only the official one has
 * approved templates, and only the unofficial one can be self-hosted.
 */
export function WhatsAppHub() {
  const t = useTranslations('Settings.whatsappHub');

  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [active, setActive] = useState<Provider>('meta');
  const [meta, setMeta] = useState<MetaState>({ configured: false, connected: false });
  const [crmbr, setCrmbr] = useState<CrmbrState>({
    configured: false,
    instances: [],
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [metaRes, crmbrRes, activeRes] = await Promise.allSettled([
      fetch('/api/whatsapp/config', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/whatsmiau/config', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/whatsmiau/active', { cache: 'no-store' }).then((r) => r.json()),
    ]);

    if (metaRes.status === 'fulfilled') {
      const value = metaRes.value as { connected?: boolean };
      setMeta({ configured: !!value?.connected, connected: !!value?.connected });
    }
    if (crmbrRes.status === 'fulfilled') {
      const value = crmbrRes.value as {
        configured?: boolean;
        instances?: CrmbrState['instances'];
      };
      setCrmbr({
        configured: !!value?.configured,
        instances: Array.isArray(value?.instances) ? value.instances : [],
      });
    }
    if (activeRes.status === 'fulfilled') {
      const value = activeRes.value as { provider?: Provider };
      if (value?.provider === 'whatsmiau' || value?.provider === 'meta') {
        setActive(value.provider);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function switchTo(provider: Provider) {
    setSwitching(true);
    try {
      // Which CRMBR connection to activate? The account may hold
      // several — the paired one is the candidate.
      const paired = crmbr.instances.find((item) => item.status === 'connected');
      const res = await fetch('/api/whatsmiau/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          provider === 'whatsmiau' && paired
            ? { provider, instance_name: paired.instance_name }
            : { provider },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('switchFailed'));
        return;
      }
      setActive(provider);
      toast.success(
        provider === 'whatsmiau' ? t('switchedToCrmbr') : t('switchedToMeta'),
      );
    } catch {
      toast.error(t('switchFailed'));
    } finally {
      setSwitching(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  // The CRMBR API counts as connected when one of the account's
  // instances is paired — the account may hold several, and any of
  // them can be the one the app sends through.
  const crmbrConnected =
    crmbr.configured &&
    crmbr.instances.some((item) => item.status === 'connected');

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* Which API is live right now */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <StatusDot tone={active === 'whatsmiau' && !crmbrConnected ? 'muted' : 'ok'} />
          <p className="text-sm text-foreground">
            {active === 'whatsmiau' ? t('usingCrmbr') : t('usingMeta')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {active === 'whatsmiau'
              ? crmbrConnected
                ? t('crmbrConnectedDetail')
                : t('crmbrNotConnectedDetail')
              : meta.connected
                ? t('metaConnectedDetail')
                : t('metaNotConnectedDetail')}
          </p>
          {active === 'whatsmiau' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={switching || !meta.connected}
              onClick={() => switchTo('meta')}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {switching ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('switchToMeta')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={switching || !crmbrConnected}
              onClick={() => switchTo('whatsmiau')}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {switching ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('switchToCrmbr')}
            </Button>
          )}
        </div>
      </div>

      {/* The two providers */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Official — Meta */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <ShieldCheck className="size-4 text-primary" />
                  {t('metaTitle')}
                </CardTitle>
                <CardDescription className="mt-1 text-muted-foreground">
                  {t('metaDesc')}
                </CardDescription>
              </div>
              <SettingsChip variant={active === 'meta' ? 'admin' : 'muted'}>
                {active === 'meta' ? t('inUse') : t('officialBadge')}
              </SettingsChip>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              {meta.connected ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  <span className="text-foreground">{t('connected')}</span>
                </>
              ) : (
                <>
                  <CircleSlash className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('notConnected')}</span>
                </>
              )}
            </div>

            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {t('metaHasTemplates')}
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {t('metaHasVerification')}
              </li>
              <li className="flex items-start gap-2">
                <MessageSquareOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {t('metaNoSelfHosted')}
              </li>
            </ul>

            <Link
              href="/settings/whatsapp/meta"
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('configure')}
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>

        {/* Non-official — CRMBR (WhatsMiau) */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <PlugZap className="size-4 text-primary" />
                  {t('crmbrTitle')}
                </CardTitle>
                <CardDescription className="mt-1 text-muted-foreground">
                  {t('crmbrDesc')}
                </CardDescription>
              </div>
              <SettingsChip variant={active === 'whatsmiau' ? 'admin' : 'warn'}>
                {active === 'whatsmiau' ? t('inUse') : t('unofficialBadge')}
              </SettingsChip>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              {crmbrConnected ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  <span className="text-foreground">{t('connected')}</span>
                </>
              ) : (
                <>
                  <CircleSlash className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('notConnected')}</span>
                </>
              )}
            </div>

            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {t('crmbrHasSelfHosted')}
              </li>
              <li className="flex items-start gap-2">
                <MessageSquareOff className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                {t('crmbrNoTemplates')}
              </li>
            </ul>

            <Link
              href="/settings/whatsapp/crmbr"
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('configure')}
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
