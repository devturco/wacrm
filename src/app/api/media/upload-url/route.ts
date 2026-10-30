import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  mediaStorageFor,
  readMediaSettings,
  resolveBucket,
} from "@/lib/media/storage";
import { normalizeContentType } from "@/lib/media/content-type";
import { CHAT_MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";
import { getT } from "@/lib/i18n/translate";

const t = getT("Api");

/**
 * Where the browser should send an attachment.
 *
 * The bytes do NOT come back to the server: the browser either uploads
 * straight to the bucket through the Supabase SDK (the bucket's RLS
 * scopes the write to the caller's own account folder) or does a PUT
 * against a URL this route signs.
 *
 * The credentials never leave the server — in the pre-signed mode what
 * comes back is a URL that is already signed, and the access key id in
 * it is an identifier, not a secret.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const body = (await request.json().catch(() => null)) as {
      fileName?: unknown;
      contentType?: unknown;
      sizeBytes?: unknown;
      bucket?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: t("common.invalidJson") }, { status: 400 });
    }

    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    if (!fileName) {
      return NextResponse.json({ error: t("common.invalidRequestBody") }, { status: 400 });
    }

    const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : 0;
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
      return NextResponse.json({ error: t("common.invalidRequestBody") }, { status: 400 });
    }

    const bucket =
      typeof body.bucket === "string" && body.bucket.trim()
        ? body.bucket.trim()
        : "chat-media";

    // The browser names the bucket it wants; the account decides where
    // its own media lives. `resolveBucket` turns "chat-media" into the
    // account's configured bucket, so the upload lands in the same
    // place the mirror and the repair write to.
    const settings = await readMediaSettings(ctx.supabase, ctx.accountId);
    const storage = await mediaStorageFor(
      settings,
      ctx.supabase,
      process.env,
      resolveBucket(settings, bucket),
    );

    // The account's own ceiling, capped by what the bucket accepts.
    const maxBytes = Math.min(
      storage.maxFileBytes ?? CHAT_MEDIA_MAX_BYTES,
      CHAT_MEDIA_MAX_BYTES,
    );
    if (sizeBytes > maxBytes) {
      return NextResponse.json(
        { error: t("common.invalidRequestBody"), maxBytes },
        { status: 413 },
      );
    }

    const contentType = normalizeContentType(
      typeof body.contentType === "string" ? body.contentType : null,
    );

    const target = await storage.prepareUpload({
      accountId: ctx.accountId,
      fileName,
      contentType,
      sizeBytes,
    });

    return NextResponse.json(target);
  } catch (err) {
    return toErrorResponse(err);
  }
}
