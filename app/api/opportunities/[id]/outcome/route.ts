import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne, transaction } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";
import type { Opportunity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record a bid outcome (won / lost / no_award). On win: sets up the contract
 * (milestone/coordination scaffolding, CPARS calendar) per spec step 12. Feeds
 * the Learning Loop and Analytics.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;
  const body = await req.json().catch(() => ({}));
  const outcome = body.outcome as "won" | "lost" | "no_award";
  if (!["won", "lost", "no_award"].includes(outcome)) {
    return NextResponse.json({ error: "outcome must be won|lost|no_award" }, { status: 400 });
  }

  const opp = await queryOne<Opportunity>(`select * from opportunities where id=$1 and org_id=$2`, [params.id, orgId]);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bid = await queryOne<{ id: string; bid_amount: number | null }>(
    `select id, bid_amount from bids where opportunity_id=$1 order by created_at desc limit 1`,
    [params.id]
  );

  const awardAmount = body.award_amount != null ? Number(body.award_amount) : null;
  if (awardAmount != null && (!Number.isFinite(awardAmount) || awardAmount <= 0)) {
    return NextResponse.json(
      { error: "Award amount must be a positive dollar figure." },
      { status: 400 }
    );
  }
  if (awardAmount != null && awardAmount > 100_000_000) {
    return NextResponse.json(
      { error: "Award amount is over $100M. Double-check the figure (dollars, not cents)." },
      { status: 400 }
    );
  }
  const lossReason = body.loss_reason ?? null;

  if (outcome === "won") {
    if (!bid) {
      return NextResponse.json(
        {
          error:
            "No bid exists for this opportunity yet. Build and submit a bid first so the win is tied to a bid record (analytics and the Learning Loop depend on it).",
        },
        { status: 400 }
      );
    }
    const contractNumber = body.contract_number ?? opp.solicitation_number ?? null;
    // Default the award amount to what we bid when the operator marks a win
    // without entering one, so the contract, active-revenue KPI, and non-SS cap
    // math have a real figure instead of a blank.
    const effectiveAward = awardAmount ?? bid.bid_amount ?? null;
    // CPARS due 7 days after contract close (spec). Default close = +180d if unknown.
    const endDate = body.end_date ?? null;
    // Atomic: mark the bid won, close the opportunity, and create the contract in
    // one transaction so a partial failure can't leave a "won" bid with no
    // contract row (or an opportunity closed with no contract).
    await transaction(async (c) => {
      if (bid) {
        await c.query(`update bids set outcome=$2, award_amount=$3, loss_reason=$4 where id=$1`, [
          bid.id,
          outcome,
          effectiveAward,
          lossReason,
        ]);
      }
      await c.query(`update opportunities set stage='won', status='closed' where id=$1`, [params.id]);
      await c.query(
        `insert into contracts
           (bid_id, opportunity_id, contract_number, award_amount, start_date, end_date,
            cpars_due_at, cpars_status, status)
         values ($1,$2,$3,$4,$5,$6,$7,'pending','active')`,
        [
          bid?.id ?? null,
          params.id,
          contractNumber,
          effectiveAward,
          body.start_date ?? null,
          endDate,
          endDate ? new Date(new Date(endDate).getTime() + 7 * 86_400_000).toISOString() : null,
        ]
      );
    });
    await logAgent({
      agent: "operator",
      action: "award-won",
      opportunityId: params.id,
      bidId: bid?.id ?? null,
      level: "success",
      message: `WON. Contract created. CPARS calendar set.`,
    });
    await enqueue("analytics-engine", {});
    // The paperwork gate moves from bidding to working the moment this is a
    // real contract: from here on, a sub without current insurance starting
    // work is the prime's exposure, not just a stalled outreach.
    await enqueue("sub-onboarding", { opportunityId: params.id });
  } else {
    if (bid) {
      await query(`update bids set outcome=$2, award_amount=$3, loss_reason=$4 where id=$1`, [
        bid.id,
        outcome,
        awardAmount,
        lossReason,
      ]);
    }
    await query(`update opportunities set stage='lost', status='closed' where id=$1`, [params.id]);
    await logAgent({
      agent: "operator",
      action: `award-${outcome}`,
      opportunityId: params.id,
      bidId: bid?.id ?? null,
      level: "info",
      message: `${outcome.toUpperCase()}${lossReason ? `: ${lossReason}` : ""}. Archived for Learning Loop.`,
    });
    await enqueue("learning-loop", {});
  }

  return NextResponse.json({ ok: true, outcome });
}
