"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Route, Target } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { LeadOriginRow } from "@/lib/leads/types";

/**
 * Where this lead came from.
 *
 * One compact line — the origin, the campaign and the date — plus a
 * chip that opens the FULL journey in a sheet: every touch, from the
 * first click to the last message.
 *
 * The badge says nothing when there is no origin: most contacts did
 * not come from a campaign, and an empty chip would be noise.
 */
export function LeadOriginBadge({
  contactId,
  compact = false,
}: {
  contactId: string;
  compact?: boolean;
}) {
  const t = useTranslations("Leads");
  const locale = useLocale();

  const [origins, setOrigins] = useState<LeadOriginRow[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchOrigins(): Promise<LeadOriginRow[]> {
      try {
        const response = await fetch(
          `/api/leads/origins?contactId=${encodeURIComponent(contactId)}`,
        );
        if (!response.ok) return [];
        const body = (await response.json()) as { origins?: LeadOriginRow[] };
        return Array.isArray(body.origins) ? body.origins : [];
      } catch {
        // A failed load must not break the contact card: the badge
        // simply does not show up.
        return [];
      }
    }

    void fetchOrigins().then((rows) => {
      if (!cancelled) setOrigins(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  if (!origins || origins.length === 0) return null;

  const primary = origins.find((origin) => origin.is_primary) ?? origins[0];
  const campaign =
    primary.utm_campaign ?? primary.campaign_id ?? primary.external_id ?? null;
  const date = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(primary.touched_at));

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Target className="size-3.5 shrink-0 text-primary" />
      {compact ? null : (
        <span className="truncate">
          {t("origin")}: {t(`channel.${primary.channel}`)}
          {campaign ? ` · ${campaign}` : ""} · {date}
        </span>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted">
          <Route className="size-3" />
          {compact
            ? (campaign ?? t(`channel.${primary.channel}`))
            : t("journey", { count: origins.length })}
        </SheetTrigger>
        <SheetContent side="right" className="sm:max-w-md!">
          <SheetHeader>
            <SheetTitle>{t("journeyTitle")}</SheetTitle>
            <SheetDescription>{t("journeyDescription")}</SheetDescription>
          </SheetHeader>

          <div className="overflow-y-auto px-4 pb-4">
            <ol className="space-y-4">
              {origins.map((origin) => (
                <li key={origin.id} className="border-l border-border pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {t(`channel.${origin.channel}`)}
                    </span>
                    {origin.is_primary ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {t("primary")}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(origin.touched_at))}
                    </span>
                  </div>

                  <dl className="mt-1.5 space-y-0.5 text-xs">
                    <OriginRow label={t("fields.campaign")} value={origin.utm_campaign} />
                    <OriginRow label={t("fields.ad")} value={origin.ad_id} />
                    <OriginRow label={t("fields.post")} value={origin.post_id} />
                    <OriginRow label={t("fields.utmSource")} value={origin.utm_source} />
                    <OriginRow label={t("fields.utmMedium")} value={origin.utm_medium} />
                    <OriginRow label={t("fields.utmContent")} value={origin.utm_content} />
                    <OriginRow label={t("fields.landingPath")} value={origin.landing_path} />
                    <OriginRow label={t("fields.referrer")} value={origin.referrer} />
                    <OriginRow label={t("fields.link")} value={origin.link_code} />
                  </dl>
                </li>
              ))}
            </ol>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** One labelled value of the journey — nothing renders for a null. */
function OriginRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 break-all text-foreground">{value}</dd>
    </div>
  );
}
