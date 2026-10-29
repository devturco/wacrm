"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Target, Trash2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsPanelHead } from "@/components/settings/settings-panel-head";
import type { CampaignLink } from "@/lib/leads/types";

/**
 * Where the leads come from.
 *
 * Three things live here:
 *
 *   1. The capture key and the script the customer pastes into their
 *      own site.
 *   2. The campaign links (`/r/<code>`) — a short link that carries
 *      the click all the way to the first WhatsApp message.
 *   3. The allowlist of hosts allowed to call the public endpoint,
 *      and the on/off switch.
 *
 * The capture key is PUBLIC: it is in the script the customer
 * publishes. It is not a credential and it never authenticates
 * against anything.
 */

interface LeadSettingsState {
  configured: boolean;
  capture_key: string | null;
  enabled: boolean;
  allowed_hosts: string[];
  links: CampaignLink[];
}

export function LeadOriginSettings() {
  const { canEditSettings, profileLoading } = useAuth();
  const t = useTranslations("Settings.leads");

  const [state, setState] = useState<LeadSettingsState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hosts, setHosts] = useState<string[]>([]);
  const [links, setLinks] = useState<CampaignLink[]>([]);
  const [hostDraft, setHostDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  const [newLabel, setNewLabel] = useState("");
  const [newDestination, setNewDestination] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/leads/settings");
      if (!response.ok) {
        toast.error(t("loadFailed"));
        return;
      }
      const body = (await response.json()) as LeadSettingsState;
      setState(body);
      setEnabled(body.enabled);
      setHosts(body.allowed_hosts);
      setLinks(body.links);
    } catch {
      toast.error(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const disabled = !canEditSettings || profileLoading || state === null;

  const dirty =
    state !== null &&
    (enabled !== state.enabled ||
      hosts.join(",") !== state.allowed_hosts.join(",") ||
      JSON.stringify(links) !== JSON.stringify(state.links));

  async function handleSave() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const response = await fetch("/api/leads/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, allowed_hosts: hosts, links }),
      });
      if (!response.ok) {
        toast.error(t("saveFailed"));
        return;
      }
      const body = (await response.json()) as LeadSettingsState;
      setState(body);
      setEnabled(body.enabled);
      setHosts(body.allowed_hosts);
      setLinks(body.links);
      toast.success(t("saveSuccess"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  function addHost() {
    const host = hostDraft.trim().toLowerCase();
    if (!host) return;
    if (hosts.includes(host)) {
      setHostDraft("");
      return;
    }
    setHosts([...hosts, host]);
    setHostDraft("");
  }

  function addLink() {
    const label = newLabel.trim();
    const destination = newDestination.trim();
    if (!destination) return;
    setLinks([
      ...links,
      {
        code: "",
        label,
        destination,
        message: "",
        created_at: new Date().toISOString(),
      },
    ]);
    setNewLabel("");
    setNewDestination("");
  }

  const scriptSnippet =
    origin && state?.capture_key
      ? `<script src="${origin}/api/leads/track.js" data-key="${state.capture_key}"></script>`
      : "";

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {/* The switch */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Target className="size-4 text-primary" />
            {t("captureTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("captureDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="leads-enabled" className="text-foreground">
              {t("enabled")}
            </Label>
            <Switch
              id="leads-enabled"
              checked={enabled}
              onCheckedChange={(checked: boolean) => setEnabled(checked)}
              disabled={disabled}
            />
          </div>

          {!canEditSettings ? (
            <p className="text-xs text-muted-foreground">{t("adminOnlyHint")}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* The key + the script */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-foreground">{t("scriptTitle")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("scriptDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="leads-key" className="text-muted-foreground">
              {t("captureKey")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="leads-key"
                readOnly
                value={state?.capture_key ?? ""}
                placeholder={t("notConfigured")}
                className="font-mono text-xs"
              />
              {state?.capture_key ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copy(state.capture_key as string)}
                  aria-label={t("copyKey")}
                >
                  <Copy className="size-4" />
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{t("keyHint")}</p>
          </div>

          {scriptSnippet ? (
            <div className="grid gap-2">
              <Label htmlFor="leads-script" className="text-muted-foreground">
                {t("script")}
              </Label>
              <div className="flex items-start gap-2">
                <Input
                  id="leads-script"
                  readOnly
                  value={scriptSnippet}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copy(scriptSnippet)}
                  aria-label={t("copyScript")}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* The campaign links */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-foreground">{t("linksTitle")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("linksDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {links.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noLinks")}</p>
          ) : (
            <ul className="space-y-2">
              {links.map((link, index) => (
                <li
                  key={`${link.code}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {link.label || link.destination}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {origin
                        ? `${origin}/r/${link.code || "…"}`
                        : `/r/${link.code || "…"}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!link.code}
                    onClick={() => copy(`${origin}/r/${link.code}`)}
                    aria-label={t("copyLink")}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() =>
                      setLinks(links.filter((_, i) => i !== index))
                    }
                    aria-label={t("removeLink")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="leads-link-label" className="text-muted-foreground">
                {t("linkLabel")}
              </Label>
              <Input
                id="leads-link-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t("linkLabelPlaceholder")}
                disabled={disabled}
              />
            </div>
            <div className="grid gap-2">
              <Label
                htmlFor="leads-link-destination"
                className="text-muted-foreground"
              >
                {t("linkDestination")}
              </Label>
              <Input
                id="leads-link-destination"
                value={newDestination}
                onChange={(e) => setNewDestination(e.target.value)}
                placeholder="wa:5511999999999"
                disabled={disabled}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addLink}
              disabled={disabled}
            >
              <Plus className="size-4" />
              {t("addLink")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("linkDestinationHint")}
          </p>
        </CardContent>
      </Card>

      {/* The allowlist */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-foreground">{t("hostsTitle")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("hostsDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {hosts.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noHosts")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {hosts.map((host) => (
                <li
                  key={host}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-foreground"
                >
                  {host}
                  <button
                    type="button"
                    onClick={() => setHosts(hosts.filter((h) => h !== host))}
                    disabled={disabled}
                    aria-label={t("removeHost")}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="leads-host" className="text-muted-foreground">
                {t("addHost")}
              </Label>
              <Input
                id="leads-host"
                value={hostDraft}
                onChange={(e) => setHostDraft(e.target.value)}
                placeholder="site.com.br"
                disabled={disabled}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addHost();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addHost}
              disabled={disabled}
            >
              <Plus className="size-4" />
              {t("addHost")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {canEditSettings ? (
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
      ) : null}
    </section>
  );
}
