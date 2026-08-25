import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { getProfileJson } from "@/lib/ai/companyProfile";
import { logAgent } from "@/lib/logger";
import { currentRequirementsFingerprint } from "@/lib/bid-package-state";
import type { Opportunity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator submits the reviewed bid package. Guards the submit-lead-hours rule + prime_only block. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "submit" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;
  const { force } = await req.json().catch(() => ({}));

  const opp = await queryOne<Opportunity>(`select * from opportunities where id=$1 and org_id=$2`, [params.id, orgId]);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bid = await queryOne<{
    id: string;
    human_flags: string[];
    qa_checklist: { ok: boolean }[] | null;
    package_ready: boolean;
    validation_json: { blockers?: string[] } | null;
    requirements_fingerprint: string | null;
    audit_findings: { severity: string; acknowledged?: boolean; finding: string }[] | null;
  }>(
    `select id, human_flags, qa_checklist, package_ready, validation_json, audit_findings,
            requirements_fingerprint
       from bids where opportunity_id=$1 order by created_at desc limit 1`,
    [params.id]
  );
  if (!bid) return NextResponse.json({ error: "No bid package to submit." }, { status: 400 });

  /**
   * The requirements must not have moved since the package was assembled.
   *
   * `package_ready` is a stored verdict. Re-running the analyst after an
   * amendment rewrites the compliance matrix on the opportunity and never
   * touches the bid, so nothing recomputed that verdict: the package stayed
   * "ready" while the requirements underneath it changed, and submitting sent
   * a package built against superseded instructions. Checked here rather than
   * only in validation because this is the last gate before it goes out, and
   * force must NOT override it: forcing past a known-outdated package is not
   * a judgement call an operator can make from this screen.
   */
  const built = bid.requirements_fingerprint;
  const current = currentRequirementsFingerprint(opp);
  if (built && built !== current) {
    return NextResponse.json(
      {
        error:
          "This solicitation's requirements changed after the package was assembled, so the package no longer matches what is being asked for. Re-run the Bid Builder, review whatever it flags, then submit.",
        needsForce: false,
        blockers: ["Requirements changed after the package was built"],
      },
      { status: 409 }
    );
  }

  // Block prime_only per past-performance policy.
  if (opp.past_perf_classification === "prime_only") {
    return NextResponse.json(
      { error: "Blocked: past performance is prime_only. Requires human resolution before submission." },
      { status: 409 }
    );
  }

  // Hard gate: every required trade must have a positive quote. Force override
  // cannot bypass missing trade pricing.
  const required = (opp.solicitation_analysis?.required_trades ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (required.length > 0) {
    const quoteRows = await query<{ trade: string | null; quote_amount: number | null }>(
      `select trade, quote_amount from quotes where opportunity_id = $1`,
      [params.id]
    ).catch(() => []);
    const quoted = new Set(
      quoteRows
        .filter((q) => Number(q.quote_amount) > 0)
        .map((q) => (q.trade ?? "").trim().toLowerCase())
        .filter(Boolean)
    );
    const missingTrades = required.filter((t) => !quoted.has(t.toLowerCase()));
    if (missingTrades.length > 0) {
      return NextResponse.json(
        {
          error: `Bid cannot be submitted. Missing pricing for: ${missingTrades.join(", ")}.`,
          needsForce: false,
          blockers: missingTrades.map(
            (t) => `${t} pricing has not been received`
          ),
        },
        { status: 409 }
      );
    }
  }

  // Block until the compliance package passes validation + the independent
  // audit has no open blockers, unless forced (non-trade items only).
  if (!bid.package_ready && !force) {
    const validationBlockers = bid.validation_json?.blockers ?? [];
    const auditBlockers = (bid.audit_findings ?? [])
      .filter((f) => f.severity === "blocker" && !f.acknowledged)
      .map((f) => f.finding);
    const blockers = [...validationBlockers, ...auditBlockers];
    return NextResponse.json(
      {
        error:
          blockers.length > 0
            ? `The submission package is not complete yet:\n• ${blockers.join("\n• ")}`
            : "The submission package has not passed compliance validation yet.",
        needsForce: true,
        blockers,
      },
      { status: 409 }
    );
  }

  // Enforce submit-lead-hours unless the operator explicitly forces.
  const profile = await getProfileJson();
  const leadHours = profile?.decision_thresholds.submit_lead_hours ?? 2;
  if (opp.deadline) {
    const hoursLeft = (new Date(opp.deadline).getTime() - Date.now()) / 3_600_000;
    if (hoursLeft < leadHours && !force) {
      return NextResponse.json(
        {
          error: `Deadline is ${hoursLeft.toFixed(1)}h away; policy requires submitting at least ${leadHours}h before. Pass force to override.`,
          needsForce: true,
        },
        { status: 409 }
      );
    }
  }

  await query(`update bids set submitted_at=now(), outcome='pending' where id=$1`, [bid.id]);
  await query(
    `update opportunities set stage='submitted', human_action_required=false where id=$1`,
    [params.id]
  );
  await logAgent({
    agent: "operator",
    action: "submit-bid",
    opportunityId: params.id,
    bidId: bid.id,
    level: "success",
    message: `Operator ${auth.email} submitted the bid package.`,
    reasoning: "Post-submission tracking now monitors SAM.gov for the award notice.",
  });

  return NextResponse.json({ ok: true });
}
