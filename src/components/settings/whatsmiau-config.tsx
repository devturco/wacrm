'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Building2,
  Loader2,
  PlugZap,
  Plus,
  Save,
  Smartphone,
  Trash2,
  Unplug,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip, StatusDot } from './settings-chip';
import { WhatsmiauInstanceCard } from './whatsmiau-instance-card';
import { WhatsmiauWebhookCard } from './whatsmiau-webhook-card';
import { validateCustomerInstanceName } from '@/lib/whatsapp/providers/whatsmiau/naming';
import {
  DEFAULT_INSTANCE_SETTINGS,
  type WhatsmiauInstanceSettings,
  type WhatsmiauStatus,
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
 * Deep-compare two settings objects.
 *
 * A plain `JSON.stringify` comparison is not enough: Postgres `jsonb`
 * does NOT preserve key order, so the row that comes back from the
 * server serialises its keys in a different order than the object the
 * form holds — every page load would look "dirty" forever.
 */
function isSameSettings(
  a: WhatsmiauInstanceSettings,
  b: WhatsmiauInstanceSettings,
): boolean {
  if (
    a.alwaysOnline !== b.alwaysOnline ||
    a.readMessages !== b.readMessages ||
    a.rejectCall !== b.rejectCall ||
    a.groupsIgnore !== b.groupsIgnore ||
    a.saveMedia !== b.saveMedia ||
    a.msgCall !== b.msgCall
  ) {
    return false;
  }
  if (
    a.webhook.enabled !== b.webhook.enabled ||
    a.webhook.base64 !== b.webhook.base64 ||
    a.webhook.url !== b.webhook.url
  ) {
    return false;
  }
  if (a.webhook.events.length !== b.webhook.events.length) return false;
  const savedEvents = new Set(b.webhook.events);
  if (!a.webhook.events.every((event) => savedEvents.has(event))) return false;

  const headers = (source: WhatsmiauInstanceSettings['webhook']['headers']) =>
    Object.entries(source).sort(([x], [y]) => x.localeCompare(y));
  const aHeaders = headers(a.webhook.headers);
  const bHeaders = headers(b.webhook.headers);
  if (aHeaders.length !== bHeaders.length) return false;
  return aHeaders.every(
    ([key, value], index) =>
      bHeaders[index][0] === key && bHeaders[index][1] === value,
  );
}

/**
 * The CRMBR API settings screen.
 *
 * The customer never holds an API key: they name their connection, we
 * provision it on our side, they scan the QR code and their number is
 * live. The screen is a list of their connections — one card for the
 * company, one to create a new connection, and the detail of the
 * connection being edited.
 */
export function WhatsmiauConfig() {
  const t = useTranslations('Settings.whatsmiau');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [syncFullHistory, setSyncFullHistory] = useState(false);
  const [platformReady, setPlatformReady] = useState(true);
  const [companyName, setCompanyName] = useState('');
  const [instances, setInstances] = useState<InstanceState[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');

  // The edited state of the SELECTED connection.
  const [settings, setSettings] = useState<WhatsmiauInstanceSettings>(
    DEFAULT_INSTANCE_SETTINGS,
  );

  const selected = useMemo(
    () => instances.find((item) => item.instance_name === selectedName) ?? null,
    [instances, selectedName],
  );

  const load = useCallback(async () => {
    setLoading(true);
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

      const next: InstanceState[] = Array.isArray(data?.instances)
        ? data.instances
        : [];
      setInstances(next);

      // Keep the selection when it still exists; otherwise fall back to
      // the connection the app is currently sending through.
      setSelectedName((current) => {
        if (current && next.some((item) => item.instance_name === current)) {
          return current;
        }
        const active = next.find((item) => item.is_active);
        return active?.instance_name ?? next[0]?.instance_name ?? null;
      });
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The form always mirrors the selected connection.
  useEffect(() => {
    setSettings(selected?.instance_settings ?? DEFAULT_INSTANCE_SETTINGS);
  }, [selected]);

  const dirty = useMemo(() => {
    if (!selected) return false;
    return !isSameSettings(settings, selected.instance_settings);
  }, [selected, settings]);

  function patchSettings(patch: Partial<WhatsmiauInstanceSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error(t('instanceNameRequired'));
      return;
    }
    // The customer names their own connection: it may carry accents
    // and spaces, and it only has to fit in 60 characters.
    if (!validateCustomerInstanceName(name).ok) {
      toast.error(t('instanceNameInvalid'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/whatsmiau/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_name: name,
          sync_full_history: syncFullHistory,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('createFailed'));
        return;
      }
      setNewName('');
      setSyncFullHistory(false);
      setSelectedName(data?.instance_name ?? name);
      toast.success(t('created'));
      await load();
    } catch {
      toast.error(t('createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(selected.instance_name)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: {
              ...settings,
              webhook: { ...settings.webhook, url: publicWebhookUrl },
            },
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('pushFailed'));
        return;
      }
      toast.success(t('saved'));
      await load();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(name: string) {
    setActivating(name);
    try {
      const res = await fetch('/api/whatsmiau/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'whatsmiau', instance_name: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('activateFailed'));
        return;
      }
      toast.success(t('activated'));
      await load();
    } catch {
      toast.error(t('activateFailed'));
    } finally {
      setActivating(null);
    }
  }

  async function handleDisconnect(name: string) {
    if (!confirm(t('disconnectConfirm'))) return;
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(name)}/disconnect`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('disconnectFailed'));
        return;
      }
      toast.success(t('disconnectDone'));
      await load();
    } catch {
      toast.error(t('disconnectFailed'));
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleted'));
      setSelectedName(null);
      await load();
    } catch {
      toast.error(t('deleteFailed'));
    }
  }

  // The address the server pushes to the provider. It is the very same
  // string on both sides — the screen never guesses it from the
  // browser's location, because the browser's location is not
  // necessarily reachable from the outside.
  const publicWebhookUrl = webhookUrl || settings.webhook.url || '';

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

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

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

      <div className="space-y-4">
        {/* The company — the name every instance is created under */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Building2 className="size-4 text-primary" />
              {t('companyTitle')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('companyDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label className="text-muted-foreground" htmlFor="whatsmiau-company">
              {t('companyName')}
            </Label>
            <Input
              id="whatsmiau-company"
              value={companyName}
              readOnly
              className="bg-muted border-border text-foreground"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {companyName ? t('companyNameHint') : t('companyNameMissing')}
              </p>
              <Link
                href="/settings/profile"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('openProfile')}
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Creating a new connection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Plus className="size-4 text-primary" />
              {t('createTitle')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('createDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground" htmlFor="whatsmiau-new-name">
                {t('instanceName')}
              </Label>
              <Input
                id="whatsmiau-new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Atendimento"
                maxLength={60}
                className="bg-muted border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                {t('instanceNameHint')}
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('syncFullHistory')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('syncFullHistoryDesc')}
                </p>
              </div>
              <Switch
                checked={syncFullHistory}
                onCheckedChange={setSyncFullHistory}
                aria-label={t('syncFullHistory')}
              />
            </div>

            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim() || !platformReady}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlugZap className="size-4" />
              )}
              {t('createInstance')}
            </Button>
          </CardContent>
        </Card>

        {/* The account's connections */}
        {instances.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Smartphone className="size-4 text-primary" />
                {t('instancesTitle')}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('instancesDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {instances.map((item) => (
                <button
                  key={item.instance_name}
                  type="button"
                  onClick={() => setSelectedName(item.instance_name)}
                  aria-pressed={item.instance_name === selectedName}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    item.instance_name === selectedName
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {item.instance_name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {item.is_active ? (
                      <SettingsChip variant="admin">{t('inUse')}</SettingsChip>
                    ) : null}
                    <SettingsChip
                      variant={
                        item.status === 'connected'
                          ? 'ok'
                          : item.status === 'error'
                            ? 'warn'
                            : 'muted'
                      }
                    >
                      {item.status === 'connected' ? (
                        <>
                          <StatusDot /> {t('connected')}
                        </>
                      ) : item.status === 'connecting' ? (
                        t('connecting')
                      ) : item.status === 'error' ? (
                        t('error')
                      ) : (
                        t('disconnected')
                      )}
                    </SettingsChip>
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t('noInstances')}
            </CardContent>
          </Card>
        )}

        {/* The detail of the selected connection */}
        {selected ? (
          <>
            <WhatsmiauInstanceCard
              instanceName={selected.instance_name}
              status={selected.status}
              phoneNumber={selected.phone_number}
              onChanged={load}
            />

            {!selected.is_active ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  {t('useThisInstanceHint')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleActivate(selected.instance_name)}
                  disabled={activating === selected.instance_name}
                  className="border-border text-foreground hover:bg-muted"
                >
                  {activating === selected.instance_name ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {t('useThisInstance')}
                </Button>
              </div>
            ) : null}

            {/* Webhook */}
            <WhatsmiauWebhookCard
              value={settings.webhook}
              onChange={(webhook) => patchSettings({ webhook })}
              publicUrl={publicWebhookUrl}
            />

            {/* Behaviors */}
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">
                  {t('behaviorsTitle')}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('behaviorsDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t('alwaysOnline')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('alwaysOnlineDesc')}
                    </p>
                  </div>
                  <Switch
                    checked={settings.alwaysOnline}
                    onCheckedChange={(next) => patchSettings({ alwaysOnline: next })}
                    aria-label={t('alwaysOnline')}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t('groupsIgnore')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('groupsIgnoreDesc')}
                    </p>
                  </div>
                  <Switch
                    checked={settings.groupsIgnore}
                    onCheckedChange={(next) => patchSettings({ groupsIgnore: next })}
                    aria-label={t('groupsIgnore')}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t('rejectCall')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('rejectCallDesc')}
                    </p>
                  </div>
                  <Switch
                    checked={settings.rejectCall}
                    onCheckedChange={(next) => patchSettings({ rejectCall: next })}
                    aria-label={t('rejectCall')}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t('readMessages')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('readMessagesDesc')}
                    </p>
                  </div>
                  <Switch
                    checked={settings.readMessages}
                    onCheckedChange={(next) => patchSettings({ readMessages: next })}
                    aria-label={t('readMessages')}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t('saveMedia')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('saveMediaDesc')}
                    </p>
                  </div>
                  <Switch
                    checked={settings.saveMedia}
                    onCheckedChange={(next) => patchSettings({ saveMedia: next })}
                    aria-label={t('saveMedia')}
                  />
                </div>

                <div className="space-y-2 rounded-lg border border-border p-3">
                  <Label className="text-muted-foreground" htmlFor="whatsmiau-msg-call">
                    {t('msgCall')}
                  </Label>
                  <Input
                    id="whatsmiau-msg-call"
                    value={settings.msgCall}
                    onChange={(e) => patchSettings({ msgCall: e.target.value })}
                    placeholder={t('msgCallPlaceholder')}
                    className="bg-muted border-border text-foreground"
                  />
                  <p className="text-xs text-muted-foreground">{t('msgCallDesc')}</p>
                </div>
              </CardContent>
            </Card>

            {/* Danger zone */}
            <Card className="border-red-900/40">
              <CardHeader>
                <CardTitle className="text-red-400">{t('dangerTitle')}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('dangerDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleDisconnect(selected.instance_name)}
                  className="border-red-900 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                >
                  <Unplug className="size-4" />
                  {t('disconnect')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDelete(selected.instance_name)}
                  className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                >
                  <Trash2 className="size-4" />
                  {t('deleteInstance')}
                </Button>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      {/* Sticky bar — the unsaved-changes anchor. It sticks to the
          bottom of the viewport while the section is on screen, and it
          stays inside the content column (never over the rail). */}
      {selected ? (
        <div className="sticky bottom-0 z-30 mt-6 border-t border-border bg-background/95 py-3 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {dirty ? t('unsavedChanges') : t('noChanges')}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={load}
                disabled={saving || !dirty}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('discard')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {t('saveSettings')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
