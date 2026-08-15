import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne, transaction } from "@/lib/db";
import { getActiveProfile, publishProfile, invalidateProfileCache } from "@/lib/ai/companyProfile";
import { renderProfileText } from "@/lib/ai/companyProfile";
import { logAgent } from "@/lib/logger";
import type { CompanyProfileJson } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Approve a Learning-Loop-proposed scoring_weights version. Activates it and
 * syncs the weights into the active Company Profile's rubric max_points so all
 * agents immediately score with the new weights.
 *
 * Every statement names the organization. The proposal was looked up by bare
 * id, and the deactivate-all step carried no filter at all, so approving one
 * customer's rubric switched off the active rubric of every other customer on
 * the platform and left them scoring against nothing. The 404 for another
 * org's id is the org guard's rule: a real UUID must not be distinguishable
 * from an invented one.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;
  const { action } = await req.json().catch(() => ({ action: "approve" }));

  const proposed = await queryOne<{ id: string; version: number; weights: Record<string, { weight: number }> }>(
    `select id, version, weights from scoring_weights where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!proposed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "reject") {
    await query(
      `update scoring_weights set approved_at=now(), approved_by=$3, is_active=false
        where id=$1 and org_id=$2`,
      [params.id, orgId, `${auth.email} (rejected)`]
    );
    return NextResponse.json({ ok: true, rejected: true });
  }

  await transaction(async (client) => {
    // Only this organization's previous rubric stands down.
    await client.query(
      `update scoring_weights set is_active=false where is_active=true and org_id=$1`,
      [orgId]
    );
    await client.query(
      `update scoring_weights set is_active=true, approved_at=now(), approved_by=$3
        where id=$1 and org_id=$2`,
      [params.id, orgId, auth.email]
    );
  });

  // Sync into the active profile's rubric so scoring uses the approved weights.
  const profile = await getActiveProfile({ fresh: true });
  if (profile) {
    const json = profile.profile_json as CompanyProfileJson;
    for (const dim of json.scoring_rubric.dimensions) {
      const w = proposed.weights[dim.key];
      if (w) dim.max_points = w.weight;
    }
    json.scoring_rubric.total_points = json.scoring_rubric.dimensions.reduce(
      (a, d) => a + d.max_points,
      0
    );
    await publishProfile(json, renderProfileText(json), `${auth.email} (weight approval)`);
  }
  invalidateProfileCache();

  await logAgent({
    agent: "operator",
    action: "approve-scoring-weights",
    level: "success",
    message: `Operator ${auth.email} approved scoring_weights v${proposed.version}.`,
  });

  return NextResponse.json({ ok: true });
}
