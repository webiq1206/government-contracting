import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { saveTemplateVersion } from "@/lib/domain/template-versions";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Editable outreach template slugs (operators cannot create new slugs). */
const EDITABLE_SLUGS = ["template_1_outreach", "template_2_followup"];

/**
 * Save a new version of an outreach template.
 *
 * Body: { subject?: string; body: string }
 *
 * Delegates to saveTemplateVersion(), which serialises concurrent saves with a
 * transaction-scoped advisory lock so (slug, version) uniqueness is never
 * violated even under simultaneous PATCH requests.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const { slug } = params;
  if (!EDITABLE_SLUGS.includes(slug)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    subject?: string;
    body?: string;
  } | null;

  if (!body || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const subject =
    typeof body.subject === "string" ? body.subject.trim() || null : null;
  const newBody = body.body.trim();

  try {
    const inserted = await saveTemplateVersion(slug, subject, newBody);

    await logAgent({
      agent: "operator",
      action: "template-update",
      level: "info",
      message: `${auth.email} saved ${slug} v${inserted.version}.`,
    });

    return NextResponse.json({ ok: true, version: inserted.version });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    throw err;
  }
}
