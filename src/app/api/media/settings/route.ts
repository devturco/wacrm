// ============================================================
// Where an account keeps its media.
//
// GET returns the account's configuration plus whether the R2
// credentials are in place on the server. Only the NAMES of the
// missing variables travel to the browser — never their values. The
// credentials live in the server's environment and the customer never
// holds a key.
//
// PUT is admin-only: the storage choice decides where every byte of
// every account's media goes.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  isAllowedMediaSize,
  readMediaSettings,
  r2MissingFromEnv,
} from "@/lib/media/storage";
import type { MediaBackend } from "@/lib/media/storage";
import { getT } from "@/lib/i18n/translate";

const t = getT("Api");

/** What the browser is allowed to see. */
interface MediaSettingsResponse {
  backend: MediaBackend;
  bucket: string;
  maxFileBytes: number;
  publicBaseUrl: string | null;
  /** Are the R2 credentials present on the server? */
  r2Configured: boolean;
  /** The names of the variables that are missing — never their values. */
  r2Missing: string[];
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole("viewer");

    const settings = await readMediaSettings(supabase, accountId);
    const missing = r2MissingFromEnv(process.env, {
      publicBaseUrl: settings.publicBaseUrl,
    });

    const body: MediaSettingsResponse = {
      backend: settings.backend,
      bucket: settings.bucket,
      maxFileBytes: settings.maxFileBytes,
      publicBaseUrl: settings.publicBaseUrl,
      r2Configured: missing.length === 0,
      r2Missing: missing,
    };

    return NextResponse.json(body);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole("admin");

    const body = (await request.json().catch(() => null)) as {
      backend?: unknown;
      bucket?: unknown;
      maxFileBytes?: unknown;
      publicBaseUrl?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json(
        { error: t("common.invalidRequestBody") },
        { status: 400 },
      );
    }

    const backend = body.backend;
    if (backend !== "supabase" && backend !== "r2") {
      return NextResponse.json(
        { error: t("common.invalidRequestBody") },
        { status: 400 },
      );
    }

    const bucket = typeof body.bucket === "string" ? body.bucket.trim() : "";
    if (!isValidBucket(bucket)) {
      return NextResponse.json(
        { error: t("media.invalidBucket") },
        { status: 400 },
      );
    }

    const maxFileBytes = body.maxFileBytes;
    if (typeof maxFileBytes !== "number" || !isAllowedMediaSize(maxFileBytes)) {
      return NextResponse.json(
        { error: t("media.invalidMaxSize") },
        { status: 400 },
      );
    }

    const publicBaseUrl = normalizePublicBaseUrl(body.publicBaseUrl);
    if (publicBaseUrl === undefined) {
      return NextResponse.json(
        { error: t("media.invalidPublicBaseUrl") },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("media_settings")
      .upsert(
        {
          account_id: accountId,
          backend,
          bucket,
          max_file_bytes: maxFileBytes,
          public_base_url: publicBaseUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id" },
      );

    if (error) {
      console.error("[media/settings] upsert error:", error);
      return NextResponse.json({ error: t("internal") }, { status: 500 });
    }

    const missing = r2MissingFromEnv(process.env, { publicBaseUrl });
    const body2: MediaSettingsResponse = {
      backend,
      bucket,
      maxFileBytes,
      publicBaseUrl,
      r2Configured: missing.length === 0,
      r2Missing: missing,
    };

    return NextResponse.json(body2);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * A bucket name, the way Supabase Storage names them: lowercase, no
 * spaces, starting with a letter or a digit.
 */
function isValidBucket(bucket: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,62}$/.test(bucket);
}

/**
 * The public base URL of the backend, or null for "use the bucket's own
 * URL". An empty string means the same as null.
 *
 * @returns undefined when the value is not a usable http(s) URL.
 */
function normalizePublicBaseUrl(
  value: unknown,
): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // The base is a prefix, not a full object url — the trailing slash
    // would double up with the object's own path.
    return trimmed.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}
