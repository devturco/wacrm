"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { repairMediaUrl } from "@/lib/media/repair-client";
import { Button } from "@/components/ui/button";

/**
 * Restores an attachment the provider still holds.
 *
 * The bytes live in the provider's temporary storage and expire; this
 * copies them into our own bucket and rewrites the row so the file is
 * ours from now on. The provider is never named to the user.
 */

interface RestoreMediaButtonProps {
  messageId: string;
  /** Called with the new, durable url. */
  onRestored: (url: string) => void;
  /** Class name for the button — the panel places it over a thumbnail. */
  className?: string;
  /** `icon-xs` for a tile overlay, `sm` for a row. */
  size?: "icon-xs" | "sm";
}

export function RestoreMediaButton({
  messageId,
  onRestored,
  className,
  size = "icon-xs",
}: RestoreMediaButtonProps) {
  const t = useTranslations("Media.panel");
  const [restoring, setRestoring] = useState(false);

  const restore = useCallback(async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const result = await repairMediaUrl(messageId);
      if (result.ok) {
        onRestored(result.url);
        toast.success(t("restored"));
        return;
      }
      switch (result.reason) {
        case "nothing":
          toast.error(t("nothingToRepair"));
          break;
        case "missing":
          toast.error(t("providerMissing"));
          break;
        case "tooLarge":
          toast.error(t("tooLarge"));
          break;
        default:
          toast.error(t("restoreFailed"));
      }
    } finally {
      setRestoring(false);
    }
  }, [messageId, onRestored, restoring, t]);

  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      className={className}
      aria-label={t("restore")}
      title={t("restore")}
      disabled={restoring}
      onClick={(event) => {
        // The tile itself opens the lightbox — restoring must not.
        event.stopPropagation();
        void restore();
      }}
    >
      {restoring ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="h-3 w-3" />
      )}
    </Button>
  );
}
