import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
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
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { action } = await req.json().catch(() => ({ action: "approve" }));

  const proposed = await queryOne<{ id: string; version: number; weights: Record<string, { weight: number }> }>(
    `select id, version, weights from scoring_weights where id=$1`,
    [params.id]
  );
  if (!proposed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "reject") {
    await query(`update scoring_weights set approved_at=now(), approved_by=$2, is_active=false where id=$1`, [
      params.id,
      `${auth.email} (rejected)`,
    ]);
    return NextResponse.json({ ok: true, rejected: true });
  }

  await transaction(async (client) => {
    await client.query(`update scoring_weights set is_active=false where is_active=true`);
    await client.query(
      `update scoring_weights set is_active=true, approved_at=now(), approved_by=$2 where id=$1`,
      [params.id, auth.email]
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
