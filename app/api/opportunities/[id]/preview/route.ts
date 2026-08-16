import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { summarizeTradeCoverage } from "@/lib/domain/trade-coverage";
import { deriveStep, stageLabel } from "@/lib/domain/journey";
import { areCallsEnabled } from "@/lib/app-settings";
import type { Bid, Opportunity, SolicitationAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The concise read of one opportunity, for the board's hover preview.
 *
 * Deliberately not opportunityDetail: that pulls 400 communications, 100
 * documents and 50 log lines to render a page, and this answers "should I
 * open this card" from four small indexed reads. The board holds up to 500
 * rows, so the alternative, shipping every card's analysis JSON to the
 * client up front, would be a multi-megabyte payload for information most
 * cards never show.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const opp = await queryOne<Opportunity>(
    `select * from opportunities where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [subs, quotes, bid, callsEnabled] = await Promise.all([
    query<{ trade: string | null; outreach_state: string | null; responded_at: string | null }>(
      `select trade, outreach_state, responded_at from opportunity_subs
        where opportunity_id=$1 limit 300`,
      [params.id]
    ),
    query<{ trade: string | null; quote_amount: number | null }>(
      `select trade, quote_amount from quotes where opportunity_id=$1 limit 200`,
      [params.id]
    ),
    queryOne<Bid>(
      `select * from bids where opportunity_id=$1 order by created_at desc limit 1`,
      [params.id]
    ),
    areCallsEnabled(),
  ]);

  const analysis = opp.solicitation_analysis as SolicitationAnalysis | null;
  const requiredTrades = analysis?.required_trades ?? [];
  const coverage = summarizeTradeCoverage({
    requiredTrades,
    subs: subs.map((s) => ({
      trade: s.trade,
      outreach_state: s.outreach_state,
      responded_at: s.responded_at,
    })),
    quotes: quotes.map((q) => ({ trade: q.trade, quote_amount: q.quote_amount })),
  });
  const required = coverage.trades.filter((t) => requiredTrades.includes(t.trade));

  const step = deriveStep({
    opportunityId: opp.id,
    stage: opp.stage,
    tier: opp.tier,
    humanActionRequired: opp.human_action_required,
    quoteCount: quotes.length,
    tradesWithQuotes: required.filter((t) => t.quotes > 0).length,
    tradeCoverageUncovered: required.filter((t) => t.quotes === 0).length,
    requiredTradeCount: required.length,
    hasBid: Boolean(bid),
    bidSubmitted: Boolean(bid?.submitted_at),
    outcome: bid?.outcome ?? null,
    pastPerfBlocked: (opp.risk_flags ?? []).includes("prime_only_blocked"),
    hasQuotes: quotes.length > 0,
    riskFlags: opp.risk_flags,
    callsEnabled,
  });

  return NextResponse.json({
    title: opp.title,
    agency: [opp.agency, opp.sub_agency].filter(Boolean).join(" · ") || null,
    solicitationNumber: opp.solicitation_number,
    stageLabel: stageLabel(opp.stage),
    score: opp.score,
    tier: opp.tier,
    deadline: opp.deadline,
    valueEstimated: opp.value_estimated,
    // The verdict the analyst wrote, which is the thing worth reading before
    // deciding whether to open the record at all.
    why:
      analysis?.pursue_recommendation?.trim() ||
      (opp.score_breakdown as { summary?: string } | null)?.summary?.trim() ||
      null,
    trades: required.map((t) => ({
      trade: t.trade,
      status: t.status,
      statusLabel: t.statusLabel,
    })),
    tradesPriced: required.filter((t) => t.quotes > 0).length,
    tradeCount: required.length,
    nextStep: { title: step.title, why: step.why, waitingOn: step.waitingOn },
  });
}
