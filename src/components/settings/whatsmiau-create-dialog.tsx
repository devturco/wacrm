'use client';

import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, PlugZap } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { WhatsmiauQrView, useWhatsmiauPairing } from './whatsmiau-pairing';
import { validateCustomerInstanceName } from '@/lib/whatsapp/providers/whatsmiau/naming';

/**
 * The four moments of creating a connection.
 *
 * - `form` — the customer names it;
 * - `creating` — we provision it on our side (this takes a while, so
 *   the screen says what is happening);
 * - `pairing` — the QR code, right here in the modal, so the customer
 *   never has to go looking for it;
 * - `paired` — the number is linked.
 */
type Stage = 'form' | 'creating' | 'pairing' | 'paired';

/** How long each message of the creation stays on screen. */
const STEP_MS = 2200;

/**
 * Creating a WhatsApp connection.
 *
 * The customer types a name, we provision the connection on our side and
 * they scan the QR code — the whole journey happens in this modal, and
 * the connection lands in the list of connections the moment it exists.
 *
 * CLOSING THE MODAL DOES NOT CANCEL THE CREATION. The request keeps
 * running and the connection shows up in the list when it is ready:
 * the customer may want to walk away and come back to the QR code
 * later. That is why the state of this modal lives HERE and not inside
 * the dialog's children — the dialog's content is unmounted when it
 * closes, the component is not.
 */
export function WhatsmiauCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when a connection was created, so the list can refresh. */
  onCreated?: () => void | Promise<void>;
}) {
  const t = useTranslations('Settings.whatsmiau');

  const [stage, setStage] = useState<Stage>('form');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [syncFullHistory, setSyncFullHistory] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const nameId = useId();
  const errorId = useId();

  // The QR of the connection that was just created. The hook is not
  // bound to an instance name: the modal pairs a connection that does
  // not exist in the list yet, and passes the name explicitly.
  const pairing = useWhatsmiauPairing(null, () => {
    setStage('paired');
    void onCreated?.();
  });

  // The rotating messages of the creation. They move on their own, so
  // a slow provisioning never looks like a frozen screen.
  useEffect(() => {
    if (stage !== 'creating') return;
    const timer = setInterval(() => {
      setStep((current) => Math.min(current + 1, 2));
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [stage]);

  const creatingMessages = [
    t('creatingStep1'),
    t('creatingStep2'),
    t('creatingStep3'),
  ];

  async function handleCreate() {
    const value = name.trim();
    if (!value) {
      setNameError(t('instanceNameRequired'));
      return;
    }
    if (!validateCustomerInstanceName(value).ok) {
      setNameError(t('instanceNameInvalid'));
      return;
    }
    setNameError(null);
    setStep(0);
    setStage('creating');

    try {
      const res = await fetch('/api/whatsmiau/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_name: value,
          sync_full_history: syncFullHistory,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStage('form');
        // The name is the only field the customer can fix right here.
        if (data?.field === 'instance_name') {
          setNameError(data?.error || t('instanceNameInvalid'));
        } else {
          toast.error(data?.error || t('createFailed'));
        }
        return;
      }

      const instanceName =
        typeof data?.instance_name === 'string' ? data.instance_name : value;
      setCreatedName(instanceName);
      toast.success(t('created'));
      // The connection exists — the list shows it from now on, even if
      // the customer closes this modal. The list refreshes on its own:
      // it must never hold the QR code hostage.
      void onCreated?.();
      setStage('pairing');
      await pairing.generateQr(instanceName);
    } catch {
      setStage('form');
      toast.error(t('createFailed'));
    }
  }

  async function retryQr() {
    if (!createdName) return;
    await pairing.generateQr(createdName);
  }

  function handleOpenChange(next: boolean) {
    if (!next && stage === 'paired') {
      // The journey is over: the next time it opens, it is a fresh form.
      setStage('form');
      setName('');
      setNameError(null);
      setSyncFullHistory(false);
      setCreatedName(null);
      setStep(0);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        {stage === 'form' ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t('createTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('createDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label
                  className="text-muted-foreground"
                  htmlFor={nameId}
                >
                  {t('instanceName')}
                </Label>
                <Input
                  id={nameId}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder="Atendimento"
                  maxLength={60}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? errorId : undefined}
                  className="bg-muted border-border text-foreground"
                />
                {nameError ? (
                  <p id={errorId} role="alert" className="text-xs text-destructive">
                    {nameError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('instanceNameHint')}
                  </p>
                )}
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
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={() => void handleCreate()}
                disabled={!name.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <PlugZap className="size-4" />
                {t('createInstance')}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {stage === 'creating' ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t('creatingTitle')}
              </DialogTitle>
              <DialogDescription
                aria-live="polite"
                className="text-muted-foreground"
              >
                {creatingMessages[step]}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4" aria-busy="true">
              <div
                role="progressbar"
                aria-label={t('creatingTitle')}
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div className="crmbr-progress h-1.5 rounded-full bg-primary" />
                <style jsx>{`
                  .crmbr-progress {
                    width: 40%;
                    animation: crmbr-progress-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                      infinite;
                  }
                  @keyframes crmbr-progress-slide {
                    0% {
                      transform: translateX(-100%);
                    }
                    100% {
                      transform: translateX(350%);
                    }
                  }
                `}</style>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('creatingHint')}
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('close')}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {stage === 'pairing' ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t('pairingTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('numberDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {pairing.loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : pairing.qr ? (
                <WhatsmiauQrView
                  qr={pairing.qr}
                  onDownload={pairing.downloadQr}
                />
              ) : (
                <div className="space-y-3 py-2 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t('qrFailed')}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void retryQr()}
                    className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t('tryAgain')}
                  </Button>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('close')}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {stage === 'paired' ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t('pairedTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('pairedDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-3">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
              <p className="text-sm font-medium text-foreground">
                {t('paired')}
              </p>
            </div>

            <DialogFooter>
              <Button
                onClick={() => handleOpenChange(false)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t('done')}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
