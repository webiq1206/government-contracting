import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { activeTemplates } from "@/lib/domain/template-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Editable outreach template slugs (operators cannot add new slugs). */
const EDITABLE_SLUGS = ["template_1_outreach", "template_2_followup"] as const;

/** Return the active version of each editable outreach template. */
export async function GET() {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  // Own copies win over platform defaults; ownedByOrg tells the editor
  // whether a save will be the org's first (copy-on-write).
  const templates = await activeTemplates(EDITABLE_SLUGS, orgId);

  return NextResponse.json({ templates });
}
