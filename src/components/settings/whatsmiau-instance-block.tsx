'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  QrCode,
  RefreshCw,
  Save,
  Smartphone,
  Trash2,
  Unplug,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { SettingsChip, StatusDot } from './settings-chip';
import { WhatsmiauQrView, useWhatsmiauPairing } from './whatsmiau-pairing';
import { WhatsmiauWebhookSection } from './whatsmiau-webhook-section';
import {
  isSameSettings,
  type WhatsmiauInstanceSettings,
  type WhatsmiauStatus,
  type WhatsmiauWebhookConfig,
} from '@/lib/whatsapp/providers/whatsmiau/settings';

/**
 * ONE connection, drawn as ONE block.
 *
 * The customer may hold several connections ("Atendimento",
 * "Atendimento 2"), and each one carries its own number, its own
 * webhook and its own behaviours. So each connection gets its own
 * block, and everything that belongs to it lives inside it — the
 * number, the webhook, the behaviours, the danger zone and the save
 * button. Nothing is selected elsewhere and edited here: the screen
 * has no "which connection am I editing?" question to answer.
 *
 * The block owns its own draft of the settings, so two blocks can be
 * edited side by side without one overwriting the other.
 */
export function WhatsmiauInstanceBlock({
  instanceName,
  status,
  phoneNumber,
  isActive,
  savedSettings,
  webhookUrl,
  onChanged,
}: {
  instanceName: string;
  status: WhatsmiauStatus;
  phoneNumber: string | null;
  isActive: boolean;
  /** The settings the server has for this connection. */
  savedSettings: WhatsmiauInstanceSettings;
  /** The public URL the SERVER pushes to the provider. */
  webhookUrl: string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('Settings.whatsmiau');
  // One block per connection means one message field per block — the
  // id is generated so two of them never collide in the DOM.
  const msgCallId = useId();

  const [baseline, setBaseline] = useState(savedSettings);
  const [draft, setDraft] = useState(savedSettings);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [confirm, setConfirm] = useState<'disconnect' | 'delete' | null>(null);

  // The server is the truth: when it hands back settings that differ
  // from what we last saw (a save, a change made elsewhere), the draft
  // follows. A reload that did not change anything leaves the user's
  // unsaved edits alone.
  useEffect(() => {
    if (isSameSettings(savedSettings, baseline)) return;
    setBaseline(savedSettings);
    setDraft(savedSettings);
  }, [savedSettings, baseline]);

  const dirty = !isSameSettings(draft, baseline);

  // The phone confirms the pairing behind our back — the provider
  // flips the instance to "open" — so the row is refreshed.
  const pairing = useWhatsmiauPairing(instanceName, () => {
    void onChanged();
  });

  function patch(patchValue: Partial<WhatsmiauInstanceSettings>) {
    setDraft((current) => ({ ...current, ...patchValue }));
  }

  function patchWebhook(webhook: WhatsmiauWebhookConfig) {
    patch({ webhook });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(instanceName)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: {
              ...draft,
              webhook: { ...draft.webhook, url: webhookUrl },
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
      await onChanged();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    try {
      const res = await fetch('/api/whatsmiau/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'whatsmiau',
          instance_name: instanceName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('activateFailed'));
        return;
      }
      toast.success(t('activated'));
      await onChanged();
    } catch {
      toast.error(t('activateFailed'));
    } finally {
      setActivating(false);
    }
  }

  async function handleDisconnect() {
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(instanceName)}/disconnect`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('disconnectFailed'));
        return;
      }
      toast.success(t('disconnectDone'));
      setConfirm(null);
      await onChanged();
    } catch {
      toast.error(t('disconnectFailed'));
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(instanceName)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleted'));
      setConfirm(null);
      await onChanged();
    } catch {
      toast.error(t('deleteFailed'));
    }
  }

  const statusChip = (
    <SettingsChip
      variant={
        status === 'connected' ? 'ok' : status === 'error' ? 'warn' : 'muted'
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
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Smartphone className="size-4 shrink-0 text-primary" />
              <span className="truncate">{instanceName}</span>
            </CardTitle>
            <CardDescription className="mt-1 text-muted-foreground">
              {status === 'connected' && phoneNumber
                ? `${t('linkedNumber')} ${phoneNumber}`
                : null}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isActive ? (
              <SettingsChip variant="admin">{t('inUse')}</SettingsChip>
            ) : null}
            {statusChip}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Not the connection in use — offer it in one click. A
            connection that is not paired yet cannot be the one the app
            sends through, so the offer only shows once it is ready. */}
        {!isActive && status === 'connected' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary-soft-2 bg-primary-soft/40 px-3 py-2.5">
            <p className="text-sm text-muted-foreground">
              {t('useThisInstanceHint')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleActivate()}
              disabled={activating || status !== 'connected'}
              className="border-border bg-background text-foreground hover:bg-muted"
            >
              {activating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {t('useThisInstance')}
            </Button>
          </div>
        ) : null}

        {/* The number */}
        <Section title={t('numberTitle')} description={t('numberDesc')}>
          {pairing.qr ? (
            <WhatsmiauQrView qr={pairing.qr} onDownload={pairing.downloadQr} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void pairing.generateQr()}
                disabled={pairing.loading}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {pairing.loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <QrCode className="size-4" />
                )}
                {status === 'connected' ? t('showQr') : t('generateQr')}
              </Button>
              {status === 'connected' ? (
                <Button
                  variant="outline"
                  onClick={() => void pairing.reconnect()}
                  disabled={pairing.reconnecting}
                  className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {pairing.reconnecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  {t('reconnect')}
                </Button>
              ) : null}
            </div>
          )}
        </Section>

        <Separator />

        {/* The webhook */}
        <Section
          title={t('webhook.title')}
          description={t('webhook.description')}
        >
          <WhatsmiauWebhookSection
            value={draft.webhook}
            onChange={patchWebhook}
            publicUrl={webhookUrl}
          />
        </Section>

        <Separator />

        {/* The behaviours */}
        <Section
          title={t('behaviorsTitle')}
          description={t('behaviorsDesc')}
        >
          <div className="space-y-3">
            <Toggle
              label={t('alwaysOnline')}
              description={t('alwaysOnlineDesc')}
              checked={draft.alwaysOnline}
              onChange={(next) => patch({ alwaysOnline: next })}
            />
            <Toggle
              label={t('groupsIgnore')}
              description={t('groupsIgnoreDesc')}
              checked={draft.groupsIgnore}
              onChange={(next) => patch({ groupsIgnore: next })}
            />
            <Toggle
              label={t('rejectCall')}
              description={t('rejectCallDesc')}
              checked={draft.rejectCall}
              onChange={(next) => patch({ rejectCall: next })}
            />
            <Toggle
              label={t('readMessages')}
              description={t('readMessagesDesc')}
              checked={draft.readMessages}
              onChange={(next) => patch({ readMessages: next })}
            />
            <Toggle
              label={t('saveMedia')}
              description={t('saveMediaDesc')}
              checked={draft.saveMedia}
              onChange={(next) => patch({ saveMedia: next })}
            />

            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label className="text-muted-foreground" htmlFor={msgCallId}>
                {t('msgCall')}
              </Label>
              <Input
                id={msgCallId}
                value={draft.msgCall}
                onChange={(e) => patch({ msgCall: e.target.value })}
                placeholder={t('msgCallPlaceholder')}
                className="bg-muted border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('msgCallDesc')}</p>
            </div>
          </div>
        </Section>

        <Separator />

        {/* The danger zone */}
        <Section title={t('dangerTitle')} description={t('dangerDesc')}>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirm('disconnect')}
              className="border-red-900 text-red-400 hover:bg-red-950/40 hover:text-red-300"
            >
              <Unplug className="size-4" />
              {t('disconnect')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setConfirm('delete')}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              <Trash2 className="size-4" />
              {t('deleteInstance')}
            </Button>
          </div>
        </Section>
      </CardContent>

      {/* The save bar of THIS connection */}
      <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {dirty ? t('unsavedChanges') : t('noChanges')}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setDraft(baseline)}
            disabled={saving || !dirty}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t('discard')}
          </Button>
          <Button
            onClick={() => void handleSave()}
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
      </CardFooter>

      <ConfirmAction
        open={confirm === 'disconnect'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t('disconnect')}
        description={t('disconnectConfirm')}
        confirmLabel={t('confirm')}
        onConfirm={handleDisconnect}
      />
      <ConfirmAction
        open={confirm === 'delete'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t('deleteInstance')}
        description={t('deleteConfirm')}
        confirmLabel={t('confirm')}
        destructive
        onConfirm={handleDelete}
      />
    </Card>
  );
}

/** A titled group of settings inside the block. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-heading text-sm font-medium text-foreground">
          {title}
        </h3>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A switch with its label and its explanation. */
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}

/**
 * The confirmation of a destructive action.
 *
 * A native `confirm()` cannot be styled and does not announce what is
 * about to happen — this one names the action and shows what it does.
 */
function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  destructive?: boolean;
}) {
  const t = useTranslations('Settings.whatsmiau');
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t('cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void handleConfirm()}
            disabled={busy}
            className={
              destructive
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
