import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { discardTemplateDraft } from "@/lib/domain/template-versions";
import { isEditableTemplateSlug } from "@/lib/domain/template-slugs";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Throw away an unpublished draft.
 *
 * POST /api/templates/[slug]/discard
 *
 * The way back from an edit somebody started and thought better of. Nothing
 * in use is touched: a draft is never the active row, so discarding one
 * cannot change a single outgoing email.
 */
export async function POST(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const ctx = await requireOrgContext({ capability: "manage_content" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const { slug } = params;
  if (!isEditableTemplateSlug(slug)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const removed = await discardTemplateDraft(slug, orgId);
  if (!removed) {
    return NextResponse.json(
      { error: "There is no saved draft for this template." },
      { status: 404 }
    );
  }

  await logAgent({
    agent: "operator",
    action: "template-discard",
    level: "info",
    message: `${auth.email} discarded the unpublished draft of ${slug}.`,
  });

  return NextResponse.json({ ok: true });
}
