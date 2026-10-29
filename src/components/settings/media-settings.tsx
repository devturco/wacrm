"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Loader2,
  HardDrive,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { MEDIA_SIZE_OPTIONS, mediaFieldVisibility } from "@/lib/media/storage";
import type { MediaBackend } from "@/lib/media/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Where this account keeps its media.
 *
 * Two backends: the Supabase bucket that ships with the project, and
 * Cloudflare R2 for whoever wants the media off our database. The
 * choice, the bucket, the size ceiling and the public base URL all
 * live in `media_settings`, one row per account.
 *
 * The R2 credentials are NOT here — they are environment variables on
 * the server. This screen only says WHICH ones are missing, by name,
 * so the person running the server knows what to set.
 */

interface MediaSettingsState {
  backend: MediaBackend;
  bucket: string;
  maxFileBytes: number;
  publicBaseUrl: string | null;
  r2Configured: boolean;
  r2Missing: string[];
}

const DEFAULT_STATE: MediaSettingsState = {
  backend: "supabase",
  bucket: "chat-media",
  maxFileBytes: 104857600,
  publicBaseUrl: null,
  r2Configured: false,
  r2Missing: [],
};

export function MediaSettings() {
  const { canEditSettings, profileLoading } = useAuth();
  const t = useTranslations("Settings.media");

  const [state, setState] = useState<MediaSettingsState | null>(null);
  const [backend, setBackend] = useState<MediaBackend>("supabase");
  const [bucket, setBucket] = useState("chat-media");
  const [maxFileBytes, setMaxFileBytes] = useState<number>(
    DEFAULT_STATE.maxFileBytes,
  );
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/media/settings");
      if (!response.ok) {
        toast.error(t("loadFailed"));
        return;
      }
      const body = (await response.json()) as MediaSettingsState;
      setState(body);
      setBackend(body.backend);
      setBucket(body.bucket);
      setMaxFileBytes(body.maxFileBytes);
      setPublicBaseUrl(body.publicBaseUrl ?? "");
    } catch {
      toast.error(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    state !== null &&
    (backend !== state.backend ||
      bucket !== state.bucket ||
      maxFileBytes !== state.maxFileBytes ||
      publicBaseUrl !== (state.publicBaseUrl ?? ""));

  async function handleSave() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const response = await fetch("/api/media/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backend,
          bucket,
          maxFileBytes,
          publicBaseUrl: publicBaseUrl.trim() === "" ? null : publicBaseUrl.trim(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(body?.error ?? t("saveFailed"));
        return;
      }
      const body = (await response.json()) as MediaSettingsState;
      setState(body);
      setBackend(body.backend);
      setBucket(body.bucket);
      setMaxFileBytes(body.maxFileBytes);
      setPublicBaseUrl(body.publicBaseUrl ?? "");
      toast.success(t("saveSuccess"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEditSettings || profileLoading || state === null;
  const r2Missing = backend === "r2" ? (state?.r2Missing ?? []) : [];
  // What the customer owns and what the server owns. The R2 bucket and
  // the R2 public URL are the server's — the screen does not offer an
  // input the server would ignore.
  const visibility = mediaFieldVisibility(backend, {
    publicBaseUrl: state?.publicBaseUrl ?? null,
    r2Missing,
  });

  // The ceiling in the unit a human reads. The raw byte count in a
  // closed dropdown helps nobody.
  const sizeLabel = (bytes: number) =>
    t("sizeOption", { mb: Math.round((bytes / 1048576) * 10) / 10 });

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <HardDrive className="size-4 text-primary" />
            {t("backend")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("backendDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <RadioGroup
            value={backend}
            onValueChange={(value) => setBackend(value as MediaBackend)}
            disabled={disabled}
            aria-label={t("backend")}
          >
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="supabase" id="backend-supabase" />
              <Label htmlFor="backend-supabase" className="flex-1 cursor-pointer leading-snug">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Cloud className="size-3.5" />
                  {t("backendSupabase")}
                </span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {t("backendSupabaseHint")}
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="r2" id="backend-r2" />
              <Label htmlFor="backend-r2" className="flex-1 cursor-pointer leading-snug">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <HardDrive className="size-3.5" />
                  {t("backendR2")}
                </span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {t("backendR2Hint")}
                </span>
              </Label>
            </div>
          </RadioGroup>

          {backend === "r2" && (
            <div
              className={
                r2Missing.length === 0
                  ? "flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
                  : "flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5"
              }
            >
              {r2Missing.length === 0 ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 text-xs">
                {r2Missing.length === 0 ? (
                  <p className="text-foreground">{t("r2Ready")}</p>
                ) : (
                  <>
                    <p className="text-foreground">{t("r2MissingTitle")}</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                      {r2Missing.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-muted-foreground">
                      {t("r2MissingHint")}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {visibility.serverOwned.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("serverOwned")}{" "}
              <span className="font-mono text-[11px]">
                {visibility.serverOwned.join(", ")}
              </span>
            </p>
          )}

          {visibility.bucket && (
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="media-bucket" className="text-muted-foreground">
                {t("bucket")}
              </Label>
              <Input
                id="media-bucket"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                disabled={disabled}
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">{t("bucketHint")}</p>
            </div>
          )}

          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">{t("maxSize")}</Label>
            <Select
              value={String(maxFileBytes)}
              onValueChange={(value) => setMaxFileBytes(Number(value))}
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{sizeLabel(maxFileBytes)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MEDIA_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {sizeLabel(size)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("maxSizeHint")}</p>
          </div>

          {visibility.publicBaseUrl && (
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="media-public-url" className="text-muted-foreground">
                {t("publicBaseUrl")}
              </Label>
              <Input
                id="media-public-url"
                value={publicBaseUrl}
                onChange={(e) => setPublicBaseUrl(e.target.value)}
                placeholder="https://media.suaempresa.com"
                disabled={disabled}
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                {t("publicBaseUrlHint")}
              </p>
            </div>
          )}

          {!canEditSettings && (
            <p className="text-xs text-muted-foreground">{t("adminOnlyHint")}</p>
          )}

          {canEditSettings && (
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
