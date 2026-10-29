"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import {
  Download,
  ExternalLink,
  FileText,
  ImageOff,
  Link2,
  Loader2,
  Music,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/i18n/format";
import { mediaFilename } from "@/lib/media/filename";
import { isProxiedMediaUrl } from "@/lib/media/blob-cache";
import { collectMediaGallery } from "@/lib/media/gallery";
import { downloadMediaMessage } from "@/lib/media/download";
import {
  buildLinkItems,
  MEDIA_PAGE_SIZE,
  type ContactLinkItem,
  type ContactMediaKind,
} from "@/lib/media/contact-media";
import { useMediaBlobUrl } from "@/hooks/use-media-blob-url";
import { MediaLightbox } from "@/components/inbox/media-lightbox";
import { RestoreMediaButton } from "@/components/media/restore-media-button";
import { Button } from "@/components/ui/button";
import type { Message } from "@/types";

/**
 * The media, documents and links a contact exchanged with us.
 *
 * Three tabs, one query each, all reading the same `messages` rows the
 * conversation holds — the panel is a view over the conversation, not a
 * second copy of it. That is the whole point of the feature: the client
 * complained that the media "disappeared", and the fix is that the
 * attachment lives in our own bucket, in the same place the message does.
 *
 * The rows are paginated (60 per page) so a long history does not pull
 * thousands of rows into the sidebar.
 */

export const CONTACT_MEDIA_PAGE_SIZE = MEDIA_PAGE_SIZE;

interface ContactMediaPanelProps {
  contactId: string;
  kind: ContactMediaKind;
  /** Display name of the contact — the lightbox labels their media. */
  contactLabel: string;
}

const DATE_FORMAT = {
  day: "numeric" as const,
  month: "short" as const,
  year: "numeric" as const,
};

export function ContactMediaPanel({
  contactId,
  kind,
  contactLabel,
}: ContactMediaPanelProps) {
  const t = useTranslations("Media.panel");

  const [messages, setMessages] = useState<Message[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [openMediaId, setOpenMediaId] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      setError(false);
      try {
        const supabase = createClient();

        // `messages` has no `account_id` — the conversation carries it.
        // Two steps instead of an embed: PostgREST resolves embedded
        // relationships from its schema cache, and a stale cache turns
        // the whole query into a hard error (issue #294).
        const { data: conversations, error: conversationsError } = await supabase
          .from("conversations")
          .select("id")
          .eq("contact_id", contactId);
        if (conversationsError) throw conversationsError;

        const conversationIds = (conversations ?? []).map((row) => row.id);
        if (conversationIds.length === 0) {
          setMessages([]);
          setHasMore(false);
          setPage(0);
          return;
        }

        const base = supabase
          .from("messages")
          .select("*")
          .in("conversation_id", conversationIds);

        const query =
          kind === "media"
            ? base.in("content_type", ["image", "video", "audio"])
            : kind === "documents"
              ? base.eq("content_type", "document")
              : base.eq("content_type", "text").like("content_text", "%http%");

        const from = nextPage * MEDIA_PAGE_SIZE;
        const { data, error: messagesError } = await query
          .order("created_at", { ascending: false })
          .range(from, from + MEDIA_PAGE_SIZE - 1);
        if (messagesError) throw messagesError;

        const rows = (data ?? []) as Message[];
        setMessages((current) =>
          nextPage === 0 ? rows : [...current, ...rows],
        );
        setHasMore(rows.length === MEDIA_PAGE_SIZE);
        setPage(nextPage);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [contactId, kind],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const linkItems = useMemo(
    () => (kind === "links" ? buildLinkItems(messages) : []),
    [kind, messages],
  );

  const gallery = useMemo(
    () => (kind === "media" ? collectMediaGallery(messages) : []),
    [kind, messages],
  );

  /**
   * A restored attachment swaps its url in place — the row keeps its
   * position in the grid, and the thumbnail re-renders from the bucket.
   */
  const handleRestored = useCallback((messageId: string, url: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, media_url: url } : message,
      ),
    );
  }, []);

  const emptyMessage =
    kind === "media"
      ? t("emptyMedia")
      : kind === "documents"
        ? t("emptyDocuments")
        : t("emptyLinks");

  if (error) {
    return (
      <PanelState
        icon={<ImageOff className="h-6 w-6" />}
        label={t("error")}
        action={
          <Button variant="outline" size="sm" onClick={() => void load(page)}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("retry")}
          </Button>
        }
      />
    );
  }

  if (loading && messages.length === 0) {
    return <PanelSkeleton kind={kind} />;
  }

  if (messages.length === 0) {
    return (
      <PanelState
        icon={
          kind === "links" ? (
            <Link2 className="h-6 w-6" />
          ) : (
            <FileText className="h-6 w-6" />
          )
        }
        label={emptyMessage}
      />
    );
  }

  return (
    <div className="space-y-3">
      {kind === "links" ? (
        <LinkList items={linkItems} />
      ) : kind === "documents" ? (
        <DocumentList messages={messages} onRestored={handleRestored} />
      ) : (
        <MediaGrid
          messages={messages}
          onOpen={setOpenMediaId}
          onRestored={handleRestored}
        />
      )}

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={loading}
          onClick={() => void load(page + 1)}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("loadMore")}
        </Button>
      )}

      {kind === "media" && (
        <MediaLightbox
          items={gallery}
          activeId={openMediaId}
          onActiveIdChange={setOpenMediaId}
          contactLabel={contactLabel}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Media tab                                                           */
/* ------------------------------------------------------------------ */

function MediaGrid({
  messages,
  onOpen,
  onRestored,
}: {
  messages: Message[];
  onOpen: (id: string) => void;
  onRestored: (messageId: string, url: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {messages.map((message) => (
        <MediaTile
          key={message.id}
          message={message}
          onOpen={onOpen}
          onRestored={onRestored}
        />
      ))}
    </div>
  );
}

function MediaTile({
  message,
  onOpen,
  onRestored,
}: {
  message: Message;
  onOpen: (id: string) => void;
  onRestored: (messageId: string, url: string) => void;
}) {
  const t = useTranslations("Media.panel");
  const url = message.media_url;
  if (!url) return null;

  // A voice note has nothing to look at — the tile hands it over instead.
  if (message.content_type === "audio") {
    return <AudioTile message={message} />;
  }

  const durable = !isProxiedMediaUrl(url);

  return (
    <button
      type="button"
      onClick={() => onOpen(message.id)}
      className="group relative aspect-square overflow-hidden rounded-lg bg-muted outline-none ring-offset-2 ring-offset-transparent focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("openMedia")}
    >
      <MediaThumb message={message} />
      {!durable && (
        <span className="absolute top-1 left-1">
          <RestoreMediaButton
            messageId={message.id}
            onRestored={(restored) => onRestored(message.id, restored)}
            className="bg-background/85 text-muted-foreground backdrop-blur-sm hover:bg-background"
          />
        </span>
      )}
    </button>
  );
}

function AudioTile({ message }: { message: Message }) {
  const t = useTranslations("Media.panel");
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadMediaMessage(message);
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }, [downloading, message, t]);

  return (
    <button
      type="button"
      onClick={() => void download()}
      aria-label={t("downloadAudio")}
      className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {downloading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Music className="h-5 w-5" />
      )}
    </button>
  );
}

function MediaThumb({ message }: { message: Message }) {
  if (message.content_type === "video") {
    return <VideoThumb message={message} />;
  }
  return <ImageThumb message={message} />;
}

/**
 * A video keeps its plain URL — the blob hook would buffer the whole file
 * before it could play, and the element streams fine off the bucket.
 */
function VideoThumb({ message }: { message: Message }) {
  const url = message.media_url;
  if (!url) return <div className="h-full w-full bg-muted" />;

  return (
    <video
      src={url}
      muted
      playsInline
      preload="metadata"
      className="h-full w-full object-cover"
    />
  );
}

function ImageThumb({ message }: { message: Message }) {
  const { src, status } = useMediaBlobUrl(message.media_url);

  if (status === "error") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted">
        <ImageOff className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (!src) {
    return <div className="h-full w-full animate-pulse bg-muted/60" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-full w-full object-cover" />
  );
}

/* ------------------------------------------------------------------ */
/* Documents tab                                                       */
/* ------------------------------------------------------------------ */

function DocumentList({
  messages,
  onRestored,
}: {
  messages: Message[];
  onRestored: (messageId: string, url: string) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {messages.map((message) => (
        <DocumentRow
          key={message.id}
          message={message}
          onRestored={onRestored}
        />
      ))}
    </ul>
  );
}

function DocumentRow({
  message,
  onRestored,
}: {
  message: Message;
  onRestored: (messageId: string, url: string) => void;
}) {
  const t = useTranslations("Media.panel");
  const [downloading, setDownloading] = useState(false);

  const name = mediaFilename(message);
  const durable = !message.media_url || !isProxiedMediaUrl(message.media_url);

  const download = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadMediaMessage(message);
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }, [downloading, message, t]);

  return (
    <li className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{name}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatDateTime(message.created_at, DATE_FORMAT)}
        </p>
      </div>
      {!durable && (
        <RestoreMediaButton
          messageId={message.id}
          onRestored={(restored) => onRestored(message.id, restored)}
        />
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("download")}
        disabled={downloading}
        onClick={() => void download()}
      >
        {downloading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
      </Button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Links tab                                                           */
/* ------------------------------------------------------------------ */

function LinkList({ items }: { items: ContactLinkItem[] }) {
  const t = useTranslations("Media.panel");

  if (items.length === 0) {
    return <PanelState icon={<Link2 className="h-6 w-6" />} label={t("emptyLinks")} />;
  }

  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 rounded-lg bg-muted/50 px-2.5 py-2 transition-colors hover:bg-muted"
          >
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {item.domain}
              </p>
              {item.title && (
                <p className="truncate text-[10px] text-muted-foreground">
                  {item.title}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {formatDateTime(item.createdAt, DATE_FORMAT)}
              </p>
            </div>
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

function PanelState({
  icon,
  label,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-xs text-muted-foreground">{label}</p>
      {action}
    </div>
  );
}

function PanelSkeleton({ kind }: { kind: ContactMediaKind }) {
  if (kind === "links") {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-11 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }

  if (kind === "documents") {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-11 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, index) => (
        <div key={index} className="aspect-square animate-pulse rounded-lg bg-muted/60" />
      ))}
    </div>
  );
}
