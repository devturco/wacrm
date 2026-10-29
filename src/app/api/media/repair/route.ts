import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { repairMessageMedia } from "@/lib/media/repair";
import { getT } from "@/lib/i18n/translate";

const t = getT("Api");

/**
 * Restore an attachment the provider still holds.
 *
 * The inbound mirror keeps new attachments in our own bucket, but the
 * old ones — and every mirror that failed — still point at the
 * provider's url, which expires. This copies the bytes over and
 * rewrites the row.
 *
 * The provider is never named in the answer: the customer sees that the
 * attachment is gone, not which vendor is behind the line.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const body = (await request.json().catch(() => null)) as {
      messageId?: unknown;
    } | null;
    const messageId =
      typeof body?.messageId === "string" ? body.messageId.trim() : "";
    if (!messageId) {
      return NextResponse.json(
        { error: t("common.invalidRequestBody") },
        { status: 400 },
      );
    }

    const outcome = await repairMessageMedia({
      db: ctx.supabase,
      accountId: ctx.accountId,
      messageId,
    });

    if (outcome.ok) {
      return NextResponse.json({
        url: outcome.url,
        repaired: outcome.repaired,
      });
    }

    switch (outcome.reason) {
      case "not-found":
        return NextResponse.json({ error: t("common.notFound") }, { status: 404 });
      case "no-media":
        return NextResponse.json(
          { error: t("media.nothingToRepair") },
          { status: 400 },
        );
      case "no-config":
        return NextResponse.json(
          { error: t("common.whatsappNotConfigured") },
          { status: 400 },
        );
      case "provider-missing":
        return NextResponse.json(
          { error: t("media.providerMissing") },
          { status: 410 },
        );
      case "too-large":
        return NextResponse.json(
          { error: t("media.tooLarge") },
          { status: 413 },
        );
      default:
        return NextResponse.json(
          { error: t("media.repairFailed") },
          { status: 500 },
        );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
