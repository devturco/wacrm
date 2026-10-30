import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  mediaStorageFor,
  readMediaSettings,
  resolveBucket,
} from "@/lib/media/storage";
import { isAccountScopedPath } from "@/lib/media/object-path";
import { getT } from "@/lib/i18n/translate";

const t = getT("Api");

/**
 * Remove an object the account uploaded but never sent.
 *
 * The delete goes through the server because the R2 backend needs a
 * signed request — the browser has no credentials. In the Supabase
 * backend the session client's RLS would allow it, but routing both
 * through here keeps one path.
 *
 * The path must sit inside the caller's own account folder: that is
 * what keeps the R2 backend account-scoped, where there is no RLS to
 * do it for us.
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const body = (await request.json().catch(() => null)) as {
      path?: unknown;
      bucket?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: t("common.invalidJson") }, { status: 400 });
    }

    const path = typeof body.path === "string" ? body.path.trim() : "";
    if (!path) {
      return NextResponse.json({ error: t("common.invalidRequestBody") }, { status: 400 });
    }

    if (!isAccountScopedPath(path, ctx.accountId)) {
      // Another account's object — 404, never a hint that it exists.
      return NextResponse.json({ error: t("common.notFound") }, { status: 404 });
    }

    const bucket =
      typeof body.bucket === "string" && body.bucket.trim()
        ? body.bucket.trim()
        : "chat-media";

    // The same resolution the upload used, so the object this removes
    // is the one that was written — the account's own bucket, and the
    // account's own backend.
    const settings = await readMediaSettings(ctx.supabase, ctx.accountId);
    const storage = await mediaStorageFor(
      settings,
      ctx.supabase,
      process.env,
      resolveBucket(settings, bucket),
    );
    await storage.remove(path);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
