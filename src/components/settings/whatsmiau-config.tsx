'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Building2, Loader2, PlugZap, Plus, Smartphone } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { WhatsmiauCreateDialog } from './whatsmiau-create-dialog';
import { WhatsmiauInstanceBlock } from './whatsmiau-instance-block';
import type {
  WhatsmiauInstanceSettings,
  WhatsmiauStatus,
} from '@/lib/whatsapp/providers/whatsmiau/settings';

interface InstanceState {
  instance_name: string;
  status: WhatsmiauStatus;
  phone_number: string | null;
  is_active: boolean;
  connected_at: string | null;
  instance_settings: WhatsmiauInstanceSettings;
  updated_at: string;
}

/**
 * The CRMBR API settings screen.
 *
 * The customer never holds an API key: they name their connection, we
 * provision it on our side, they scan the QR code and their number is
 * live.
 *
 * The screen is ONE BLOCK PER CONNECTION, and everything about a
 * connection lives inside its own block — the number, the webhook, the
 * behaviours, the danger zone and the save button. There is no
 * "selected connection" to keep track of: a customer with three
 * connections sees three complete blocks, and edits them side by side.
 *
 * Creating a connection happens in a MODAL, opened from the button
 * next to this panel's title.
 */
export function WhatsmiauConfig() {
  const t = useTranslations('Settings.whatsmiau');

  const [loading, setLoading] = useState(true);
  const [platformReady, setPlatformReady] = useState(true);
  const [companyName, setCompanyName] = useState('');
  const [instances, setInstances] = useState<InstanceState[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsmiau/config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('loadFailed'));
        return;
      }

      setPlatformReady(Boolean(data?.configured));
      setCompanyName(data?.company_name ?? '');
      // The address the SERVER pushes to the provider. It comes from
      // the server on purpose: the provider has to be able to reach
      // it, and the browser's own origin is a development address
      // during local testing.
      setWebhookUrl(typeof data?.webhook_url === 'string' ? data.webhook_url : '');
      setInstances(Array.isArray(data?.instances) ? data.instances : []);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      // Only the FIRST load blanks the screen: a refresh after a save
      // must not make the panel flicker, and it must not unmount the
      // "new connection" modal — the customer may be pairing a number
      // in there right now.
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const createButton = (
    <Button
      onClick={() => setCreateOpen(true)}
      disabled={!platformReady}
      className="bg-primary text-primary-foreground hover:bg-primary/90"
    >
      <Plus className="size-4" />
      {t('createTitle')}
    </Button>
  );

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={createButton}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <Alert className="mb-4 border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <PlugZap className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <AlertTitle className="mb-1 text-foreground">
                  {t('noTemplatesTitle')}
                </AlertTitle>
                <AlertDescription className="text-sm text-muted-foreground">
                  {t('noTemplatesDesc')}
                </AlertDescription>
              </div>
            </div>
          </Alert>

          {!platformReady ? (
            <Alert variant="destructive" className="mb-4 p-4">
              <AlertTitle>{t('platformUnavailableTitle')}</AlertTitle>
              <AlertDescription className="text-sm">
                {t('platformUnavailableDesc')}
              </AlertDescription>
            </Alert>
          ) : null}

          {/* The company — only when it has no name yet. A company that
              already named itself in the profile does not need to be
              reminded of it here. */}
          {!companyName ? (
            <Alert className="mb-4 border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <AlertTitle className="mb-1 text-foreground">
                    {t('companyMissingTitle')}
                  </AlertTitle>
                  <AlertDescription className="text-sm text-muted-foreground">
                    {t('companyNameMissing')}
                  </AlertDescription>
                  <Link
                    href="/settings/profile"
                    className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {t('openProfile')}
                  </Link>
                </div>
              </div>
            </Alert>
          ) : null}

          {/* The account's connections — one block each */}
          {instances.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Smartphone className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('emptyTitle')}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('emptyDesc')}
                  </p>
                </div>
                {createButton}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <div>
                <CardTitle className="font-heading text-sm font-medium text-foreground">
                  {t('instancesTitle')}
                </CardTitle>
                <CardDescription className="mt-1 text-xs text-muted-foreground">
                  {t('instancesDesc')}
                </CardDescription>
              </div>

              {instances.map((item) => (
                <WhatsmiauInstanceBlock
                  key={item.instance_name}
                  instanceName={item.instance_name}
                  status={item.status}
                  phoneNumber={item.phone_number}
                  isActive={item.is_active}
                  savedSettings={item.instance_settings}
                  webhookUrl={webhookUrl}
                  onChanged={load}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Creating a connection — the whole journey happens in here. */}
      <WhatsmiauCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={load}
      />
    </section>
  );
}
