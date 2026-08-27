import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { publishTemplateDraft } from "@/lib/domain/template-versions";
import { templateDraft } from "@/lib/domain/template-store";
import { isEditableTemplateSlug } from "@/lib/domain/template-slugs";
import { validateTemplate } from "@/lib/domain/outreach-validation";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Put a saved draft into use.
 *
 * POST /api/templates/[slug]/publish
 *
 * The only route that sets is_active on a template, which is what keeps a
 * half-finished edit out of a subcontractor's inbox: saving writes a draft,
 * and the platform keeps sending the approved wording until somebody here
 * says otherwise.
 *
 * The draft is validated again before it goes live. It was validated on save,
 * but a template can be saved and published days apart, and the send that
 * would break happens at 3am when nobody is watching.
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

  const draft = await templateDraft(slug, orgId);
  if (!draft) {
    return NextResponse.json(
      { error: "There is no saved draft for this template. Save your changes first." },
      { status: 404 }
    );
  }

  const problems = validateTemplate({ subject: draft.subject, body: draft.body });
  if (problems.length) {
    return NextResponse.json(
      { error: problems.map((p) => p.message).join(" "), problems },
      { status: 422 }
    );
  }

  const published = await publishTemplateDraft(slug, orgId, auth.email);
  if (!published) {
    // The draft was published or discarded between the read above and here,
    // which is a second operator on the same template rather than a fault.
    return NextResponse.json(
      { error: "That draft is no longer waiting. Reload to see the current wording." },
      { status: 409 }
    );
  }

  await logAgent({
    agent: "operator",
    action: "template-publish",
    level: "info",
    message: `${auth.email} published ${slug} v${published.version}. It is what the platform sends from now on.`,
  });

  return NextResponse.json({ ok: true, version: published.version });
}
