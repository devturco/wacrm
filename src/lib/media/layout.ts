// ============================================================
// Where a piece of media lives inside the account's storage.
//
// Every account gets a tree of its own:
//
//   <root>/
//     avatar/       — the contacts' profile pictures
//     midias/       — images, videos and audio
//     documentos/   — PDFs, spreadsheets, everything else
//
// <root> depends on the backend:
//
//   Supabase — `account-<uuid>`. The bucket's RLS matches the FIRST
//     path segment, so this name is not ours to choose.
//   R2 — the company's name, slugified, plus a short id of the
//     account. R2 has no RLS, so the folder is the only thing that
//     keeps one tenant's files out of another's reach — and the id
//     keeps two companies with the same name apart.
//
// The FILE name is the name the user knows the file by. The last
// segment of the url IS the file's name, and that is what a WhatsApp
// provider shows the recipient when it names the attachment after the
// url it downloaded — so a document sent as "Proposta Comercial.pdf"
// arrives as "Proposta Comercial.pdf", never as a timestamped blob.
//
// The uniqueness lives in a folder of its own, never in the name:
//
//   storm-eletronicos-3f2a1b9c/
//     avatar/8e3f2b1c….jpg
//     midias/20261030-143205-412/foto-da-loja.jpg
//     documentos/20261030-150000-777/Proposta Comercial.pdf
//
// Everything here is pure — no I/O, no client — so the naming rules
// can be tested on their own.
// ============================================================

import { extensionForMime, sanitizeFilename } from "./filename";

/** The folders an account's media is split into. */
export const MEDIA_FOLDERS = ["avatar", "midias", "documentos"] as const;

export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

/**
 * The extensions that make a file a "mídia" — something you look at
 * or listen to — rather than a document.
 *
 * The extension wins over the MIME type on purpose: the browser
 * reports `application/octet-stream` for half the files it picks, and
 * a `.png` is a picture whatever the browser said about it.
 */
const MEDIA_EXTENSIONS = new Set([
  // images
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic",
  "heif", "avif", "svg", "jfif", "ico",
  // video
  "mp4", "m4v", "mov", "3gp", "3g2", "webm", "mkv", "avi", "mpg",
  "mpeg", "wmv", "flv",
  // audio
  "mp3", "m4a", "ogg", "oga", "opus", "wav", "aac", "amr", "weba",
  "aiff", "mid",
]);

/**
 * The extension of a file name, lower-cased and without the dot.
 * Returns "" when there is none.
 */
export function extensionOf(fileName: string | null | undefined): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec((fileName ?? "").trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Which folder a file belongs to.
 *
 * Everything that is not a picture, a video or a sound is a document
 * — a PDF, a spreadsheet, a `.zip`. The audio/video/image MIME types
 * only decide when the name carries no extension to go by.
 */
export function folderForFile(
  fileName?: string | null,
  contentType?: string | null,
): MediaFolder {
  const extension = extensionOf(fileName);
  if (extension) {
    return MEDIA_EXTENSIONS.has(extension) ? "midias" : "documentos";
  }

  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/")
  ) {
    return "midias";
  }
  return "documentos";
}

/**
 * A slug of the account's name — the folder the company browses.
 *
 * Accents go, spaces become dashes, and the result is capped so the
 * path stays sane. An account with no name gets "empresa".
 */
export function slugifyCompany(name: string | null | undefined): string {
  const slug = (name ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "empresa";
}

/**
 * The account's folder inside the R2 bucket: the company's name plus
 * a short piece of the account id.
 *
 * The id is what makes the folder PRIVATE to the account. R2 has no
 * RLS — the path is the only boundary there is — and two accounts can
 * carry the same company name ("Minha Empresa" is the default half
 * the signups never change). Without the id, one account could read —
 * and delete — the other's files.
 *
 * The id is short on purpose: the folder stays readable in the bucket
 * console, and the account uuid is already the thing that makes it
 * unique.
 */
export function companyFolder(
  accountName: string | null | undefined,
  accountId: string,
): string {
  const slug = slugifyCompany(accountName);
  const suffix = (accountId ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase();
  return suffix ? `${slug}-${suffix}` : slug;
}

/**
 * The first segment of every path this account writes.
 *
 * Supabase keeps `account-<uuid>`: the bucket's write policies match
 * that exact first segment, and nothing else is allowed there. R2 has
 * no such rule, so it gets the readable company folder instead.
 */
export function accountRoot(
  backend: "supabase" | "r2",
  accountId: string,
  accountName?: string | null,
): string {
  if (backend === "r2") return companyFolder(accountName, accountId);
  return `account-${accountId}`;
}

/**
 * The name a file is stored under — the user's own name, made safe.
 *
 * Only what a file system (or an url) cannot hold is replaced: path
 * separators, control characters and the handful of characters Windows
 * rejects. The spaces and the accents stay — the name is the first
 * thing the user sees when they download the file, and the last
 * segment of the url the provider reads.
 *
 * A name with no extension gets one from the MIME type, so a file
 * called "contrato" arrives as "contrato.pdf" and not as a nameless
 * blob.
 */
export function safeFileName(
  fileName: string | null | undefined,
  contentType?: string | null,
): string {
  const safe = sanitizeFilename(fileName ?? "");
  const extension = extensionOf(safe);
  if (safe && extension) return safe;

  const mimeExtension = extensionForMime(contentType);
  if (!safe) return `arquivo.${mimeExtension}`;
  return `${safe}.${mimeExtension}`;
}

/**
 * A sortable, human-readable stamp — the folder a fresh upload lands
 * in: `20261030-143205-412`.
 *
 * The milliseconds are what make two uploads of the SAME file name in
 * the same second land in different folders instead of fighting over
 * one key.
 */
export function stampFolder(now: Date = new Date()): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return [
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    pad(now.getMilliseconds(), 3),
  ].join("-");
}

/**
 * A short, stable hash of a media id — the uniqueness segment of an
 * inbound attachment.
 *
 * Stable matters: the provider redelivers, and the second copy of a
 * message has to land on the SAME key so the object is rewritten
 * instead of orphaned next to a duplicate.
 */
export function hashId(value: string | null | undefined): string {
  let hash = 2166136261;
  const text = value ?? "";
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The day of a provider timestamp — epoch seconds or an ISO string. */
function dayOf(timestamp: number | string | null | undefined): string {
  if (timestamp === null || timestamp === undefined || timestamp === "") {
    return "";
  }
  const date = toDate(timestamp);
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/**
 * A provider timestamp as a Date.
 *
 * The providers send epoch SECONDS, as a number or as a string — the
 * string form is the one that bites, because `new Date("1754899200")`
 * is not a date at all. Milliseconds are thirteen digits long, so a
 * number that big is already milliseconds.
 */
function toDate(timestamp: number | string): Date | null {
  const text =
    typeof timestamp === "number" ? String(timestamp) : timestamp.trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const value = Number(text);
    const millis = value >= 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The folder segment of an inbound attachment: the day it arrived plus
 * a short hash of the media id.
 *
 * The day makes the bucket browsable ("what came in on the 30th"), the
 * hash keeps two attachments of the same name apart.
 */
export function inboundSegment(
  mediaId: string | null | undefined,
  timestamp?: number | string | null,
): string {
  const day = dayOf(timestamp);
  const hash = hashId(mediaId);
  return day ? `${day}-${hash}` : hash;
}

/**
 * The path of a file inside the account's tree.
 *
 * `segment` is the uniqueness folder — a stamp for a fresh upload, the
 * inbound segment for an attachment that came in. Without it the file
 * lands directly in the folder, which is what a profile picture wants
 * (the contact id in the name already keeps it unique).
 */
export function mediaPath(args: {
  root: string;
  folder: MediaFolder;
  fileName: string;
  contentType?: string | null;
  segment?: string | null;
}): string {
  const name = safeFileName(args.fileName, args.contentType);
  const segment = (args.segment ?? "").replace(/[^a-zA-Z0-9_-]+/g, "");
  if (!segment) return `${args.root}/${args.folder}/${name}`;
  return `${args.root}/${args.folder}/${segment}/${name}`;
}

/**
 * The public url of an object — every segment percent-encoded, so a
 * name with a space or an accent is still a valid url for the
 * provider to fetch.
 */
export function encodeObjectPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
