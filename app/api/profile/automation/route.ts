import { NextResponse } from "next/server";
import { requireUser, requireCapability } from "@/lib/api-auth";
import {
  getActiveProfile,
  publishProfile,
  renderProfileText,
} from "@/lib/ai/companyProfile";
import { logAgent } from "@/lib/logger";
import type { CompanyProfileJson } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Focused control for the auto-pursue automation settings, so the operator can
 * tune them without hand-editing the full profile JSON. Publishes a new profile
 * version (so every agent picks it up immediately).
 */
export async function POST(req: Request) {
  const auth = await requireCapability("manage_profile");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const profile = await getActiveProfile({ fresh: true });
  if (!profile) {
    return NextResponse.json({ error: "No active Company Profile." }, { status: 400 });
  }
  const json = profile.profile_json as CompanyProfileJson;
  const t = json.decision_thresholds;

  // pursue_min_score: 1-100, must stay above review_min_score.
  if (body.pursue_min_score != null) {
    const v = Math.round(Number(body.pursue_min_score));
    if (!Number.isFinite(v) || v < 1 || v > 100) {
      return NextResponse.json({ error: "Auto-pursue score must be between 1 and 100." }, { status: 400 });
    }
    if (v <= t.review_min_score) {
      return NextResponse.json(
        { error: `Auto-pursue score must be above the review floor (${t.review_min_score}).` },
        { status: 400 }
      );
    }
    t.pursue_min_score = v;
  }

  if (typeof body.block_prime_only === "boolean") {
    t.block_prime_only = body.block_prime_only;
  }
  if (body.review_min_score != null) {
    const v = Math.round(Number(body.review_min_score));
    if (Number.isFinite(v) && v >= 1 && v < t.pursue_min_score) t.review_min_score = v;
  }

  const version = await publishProfile(json, renderProfileText(json), auth.email).then(
    (p) => p.version
  );
  await logAgent({
    agent: "operator",
    action: "update-automation",
    level: "info",
    message: `Operator ${auth.email} set auto-pursue score to ${t.pursue_min_score}, block_prime_only=${t.block_prime_only ?? false}.`,
  });

  return NextResponse.json({
    ok: true,
    version,
    pursue_min_score: t.pursue_min_score,
    review_min_score: t.review_min_score,
    block_prime_only: t.block_prime_only ?? false,
  });
}
