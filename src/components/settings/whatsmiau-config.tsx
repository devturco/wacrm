'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  RefreshCw,
  Save,
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
import { WhatsmiauInstanceCard } from './whatsmiau-instance-card';
import { WhatsmiauWebhookCard } from './whatsmiau-webhook-card';
import { validateInstanceName } from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  DEFAULT_INSTANCE_SETTINGS,
  MASKED_API_KEY,
  type WhatsmiauInstanceSettings,
  type WhatsmiauStatus,
} from '@/lib/whatsapp/providers/whatsmiau/settings';

const DEFAULT_BASE_URL = 'https://api.whatsmiau.dev/v2';

interface SavedState {
  instance_name: string;
  base_url: string;
  api_key_masked: string;
  status: WhatsmiauStatus;
  phone_number: string | null;
  instance_settings: WhatsmiauInstanceSettings;
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
 * The CRMBR (non-official WhatsApp API) settings screen.
 *
 * Our database is the source of truth: "Salvar" writes the config and
 * then pushes the settings and the webhook to the provider. "Verificar"
 * asks the provider what it has and reports the difference.
 */
export function WhatsmiauConfig() {
  const t = useTranslations('Settings.whatsmiau');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [syncFullHistory, setSyncFullHistory] = useState(false);
  const [instanceExists, setInstanceExists] = useState(false);
  const [origin, setOrigin] = useState('');

  // The saved state — the baseline the dirty check compares against.
  const [saved, setSaved] = useState<SavedState | null>(null);

  // The edited state.
  const [instanceName, setInstanceName] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [settings, setSettings] = useState<WhatsmiauInstanceSettings>(
    DEFAULT_INSTANCE_SETTINGS,
  );

  // The webhook URL is derived from the CURRENT origin — never from
  // the stored row, which would be wrong the day the app moves host.
  // The server rebuilds the very same URL on every push.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const publicWebhookUrl = origin
    ? `${origin}/api/whatsmiau/webhook`
    : (settings.webhook.url ?? '');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsmiau/config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('loadFailed'));
        return;
      }
      if (!data?.configured) {
        setSaved(null);
        setInstanceExists(false);
        setInstanceName('');
        setBaseUrl(DEFAULT_BASE_URL);
        setApiKey('');
        setSettings(DEFAULT_INSTANCE_SETTINGS);
        return;
      }
      const next: SavedState = {
        instance_name: data.instance_name ?? '',
        base_url: data.base_url ?? DEFAULT_BASE_URL,
        api_key_masked: data.api_key_masked ?? MASKED_API_KEY,
        status: data.status ?? 'disconnected',
        phone_number: data.phone_number ?? null,
        instance_settings: data.instance_settings ?? DEFAULT_INSTANCE_SETTINGS,
      };
      setSaved(next);
      setInstanceName(next.instance_name);
      setBaseUrl(next.base_url);
      setApiKey('');
      setSettings(next.instance_settings);
      setInstanceExists(Boolean(next.instance_name));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!saved) return Boolean(apiKey.trim()) || Boolean(instanceName.trim());
    if (apiKey.trim()) return true;
    if (instanceName.trim() !== saved.instance_name) return true;
    if (baseUrl.trim() !== saved.base_url) return true;
    return !isSameSettings(settings, saved.instance_settings);
  }, [apiKey, baseUrl, instanceName, saved, settings]);

  function patchSettings(patch: Partial<WhatsmiauInstanceSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  /** The instance name is part of every provider URL — validate it here. */
  function checkInstanceName(name: string): boolean {
    const nameCheck = validateInstanceName(name);
    if (!nameCheck.ok) {
      toast.error(t('instanceNameInvalid'));
      return false;
    }
    return true;
  }

  async function handleSave() {
    const name = instanceName.trim();
    if (!name) {
      toast.error(t('instanceNameRequired'));
      return;
    }
    if (!checkInstanceName(name)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/whatsmiau/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          base_url: baseUrl.trim(),
          instance_name: name,
          instance_settings: {
            ...settings,
            webhook: { ...settings.webhook, url: publicWebhookUrl },
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('saveFailed'));
        return;
      }
      if (data.warning) {
        toast.warning(t('savedButNotVerified', { warning: data.warning }));
      } else {
        toast.success(t('saved'));
      }

      // Push to the provider: our database is the source of truth, so
      // the instance and the webhook have to follow.
      if (instanceExists && saved?.instance_name === name) {
        const put = await fetch(
          `/api/whatsmiau/instances/${encodeURIComponent(name)}`,
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
        if (!put.ok) {
          const putData = await put.json();
          toast.error(putData?.error || t('pushFailed'));
        }
      } else {
        const created = await fetch('/api/whatsmiau/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instance_name: name,
            sync_full_history: syncFullHistory,
          }),
        });
        if (!created.ok) {
          const createdData = await created.json();
          toast.error(createdData?.error || t('pushFailed'));
        } else {
          setInstanceExists(true);
        }
      }

      await load();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    const name = instanceName.trim();
    if (!name) {
      toast.error(t('instanceNameRequired'));
      return;
    }
    if (!checkInstanceName(name)) return;
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
      setInstanceExists(true);
      toast.success(t('created'));
      await load();
    } catch {
      toast.error(t('createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function handleVerify() {
    const name = saved?.instance_name;
    if (!name) {
      toast.error(t('nothingToVerify'));
      return;
    }
    setVerifying(true);
    try {
      const [listRes, stateRes] = await Promise.all([
        fetch('/api/whatsmiau/instances', { cache: 'no-store' }).then((r) =>
          r.json(),
        ),
        fetch(`/api/whatsmiau/instances/${encodeURIComponent(name)}`, {
          cache: 'no-store',
        }).then((r) => r.json()),
      ]);
      const instances = Array.isArray(listRes?.instances)
        ? listRes.instances
        : [];
      const found = instances.find(
        (item: { name?: string }) => item?.name === name,
      );
      if (!found) {
        toast.error(t('instanceNotFoundAtProvider'));
        return;
      }
      if (stateRes?.state !== 'open') {
        toast.warning(t('instanceNotOpen'));
      } else {
        toast.success(t('verified'));
      }
      await load();
    } catch {
      toast.error(t('verifyFailed'));
    } finally {
      setVerifying(false);
    }
  }

  async function handleDisconnect() {
    const name = saved?.instance_name;
    if (!name) return;
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

  async function handleDelete() {
    const name = saved?.instance_name;
    if (!name) return;
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
      setInstanceExists(false);
      await load();
    } catch {
      toast.error(t('deleteFailed'));
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

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button
            variant="outline"
            onClick={handleVerify}
            disabled={verifying || !saved?.instance_name}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {verifying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('verify')}
          </Button>
        }
      />

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

      <div className="space-y-4">
        {/* Connection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('connectionTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('connectionDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground" htmlFor="whatsmiau-api-key">
                {t('apiKey')}
              </Label>
              <div className="relative">
                <Input
                  id="whatsmiau-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={saved?.api_key_masked ?? MASKED_API_KEY}
                  autoComplete="off"
                  className="bg-muted border-border pr-10 text-foreground placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((current) => !current)}
                  aria-label={t('toggleKeyVisibility')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="whatsmiau-base-url">
                  {t('baseUrl')}
                </Label>
                <Input
                  id="whatsmiau-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={DEFAULT_BASE_URL}
                  className="bg-muted border-border font-mono text-sm text-foreground"
                />
                <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="whatsmiau-instance-name">
                  {t('instanceName')}
                </Label>
                <Input
                  id="whatsmiau-instance-name"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="Atendimento01"
                  className="bg-muted border-border text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t('instanceNameHint')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={handleCreate}
                disabled={creating || !instanceName.trim()}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <PlugZap className="size-4" />
                )}
                {t('createInstance')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Linking the phone */}
        {saved ? (
          <WhatsmiauInstanceCard
            instanceName={saved.instance_name || null}
            status={saved.status}
            phoneNumber={saved.phone_number}
            onChanged={load}
          />
        ) : null}

        {/* Webhook */}
        {saved ? (
          <WhatsmiauWebhookCard
            value={settings.webhook}
            onChange={(webhook) => patchSettings({ webhook })}
            publicUrl={publicWebhookUrl}
          />
        ) : null}

        {/* Behaviors */}
        {saved ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('behaviorsTitle')}</CardTitle>
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
                  disabled={instanceExists}
                  aria-label={t('syncFullHistory')}
                />
              </div>
              {instanceExists ? (
                <p className="text-xs text-muted-foreground">
                  {t('syncFullHistoryLocked')}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Danger zone */}
        {saved?.instance_name ? (
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
                onClick={handleDisconnect}
                className="border-red-900 text-red-400 hover:bg-red-950/40 hover:text-red-300"
              >
                <Unplug className="size-4" />
                {t('disconnect')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              >
                <Trash2 className="size-4" />
                {t('deleteInstance')}
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Sticky bar — the unsaved-changes anchor. It sticks to the
          bottom of the viewport while the section is on screen, and it
          stays inside the content column (never over the rail). */}
      <div className="sticky bottom-0 z-30 mt-6 border-t border-border bg-background/95 py-3 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
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
    </section>
  );
}
