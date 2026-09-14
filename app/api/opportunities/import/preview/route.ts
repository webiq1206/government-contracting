import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { previewSolicitationUrl } from "@/lib/solicitation-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read a pasted solicitation link and report what it says, without saving.
 *
 * Deliberately read-only, like the SAM profile import: the person sees what
 * was found, corrects it, and saves through the collection route. A link that
 * cannot be read answers with why and with the ways to continue.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const url = typeof body.url === "string" ? body.url.trim().slice(0, 2000) : "";
  if (!url) return NextResponse.json({ error: "Paste a link first." }, { status: 400 });
  const preview = await previewSolicitationUrl(ctx.orgId, url);
  if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: 400 });
  return NextResponse.json(preview);
}
