import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { getProfileJson } from "@/lib/ai/companyProfile";
import { bidForTargetMargin, isOutOfRange, type CompStats } from "@/lib/domain/pricing";
import { benchmarkFor } from "@/lib/domain/comp-reliability";
import { logAgent } from "@/lib/logger";
import type { Opportunity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QuoteInput {
  trade?: string;
  subcontractorId?: string;
  quote_amount: number;
  payment_terms?: string;
  notes?: string;
}

/** Operator enters written sub quotes; platform prices the bid + flags out-of-range, then triggers Bid Builder. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const body = await req.json().catch(() => ({}));
  const items: QuoteInput[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "No quotes provided." }, { status: 400 });
  }

  const opp = await queryOne<Opportunity>(`select * from opportunities where id=$1 and org_id=$2`, [params.id, orgId]);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const profile = await getProfileJson();

  /**
   * The benchmark a quote may be flagged against, or null.
   *
   * Two bugs lived here. The median was read from a flat `pricing_summary.median`
   * while Pricing Research writes it under `comp_stats`, so the flag was quietly
   * dead. Reading the real path alone would have been worse: on a NAICS bucket
   * that mixes a $12k inspection with a $2M overhaul, a +/-25% tolerance around
   * its median flags honest quotes. benchmarkFor hands back a number only when
   * the awards are comparable, otherwise the incumbent's award, otherwise null.
   */
  const pricingSummary = (
    opp.raw_json as {
      pricing_summary?: {
        comp_stats?: Partial<CompStats>;
        comp_count?: number;
        incumbent?: { last_award_amount?: number } | null;
      };
    } | null
  )?.pricing_summary;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const stats = pricingSummary?.comp_stats;
  const benchmark = benchmarkFor(
    {
      count: num(stats?.count ?? pricingSummary?.comp_count),
      average: num(stats?.average),
      median: num(stats?.median),
      p25: num(stats?.p25),
      p75: num(stats?.p75),
    },
    { incumbentLastAward: num(pricingSummary?.incumbent?.last_award_amount) || null }
  );
  const tolerance = profile?.pricing_rules.out_of_range_tolerance_pct ?? 20;

  let subTotal = 0;
  let saved = 0;
  const rejected: Array<{ trade: string | null; reason: string }> = [];
  const warnings: string[] = [];
  for (const q of items) {
    const amount = Number(q.quote_amount);
    // All money in this system is whole US dollars (never cents).
    if (!Number.isFinite(amount) || amount <= 0) {
      rejected.push({
        trade: q.trade ?? null,
        reason: "Quote amount must be a positive dollar figure.",
      });
      continue;
    }
    if (amount > 100_000_000) {
      rejected.push({
        trade: q.trade ?? null,
        reason: "Quote is over $100M. Enter dollars, not cents.",
      });
      continue;
    }
    if (amount > 10_000_000) {
      warnings.push(`${q.trade ?? "Quote"} is over $10M. Double-check the figure.`);
    }
    subTotal += amount;
    saved++;
    let outOfRange = false;
    let comparison: Record<string, unknown> | null = null;
    if (benchmark != null) {
      const bid = bidForTargetMargin(amount, profile?.target_margin_pct ?? 20);
      const r = isOutOfRange(bid, benchmark, tolerance);
      outOfRange = r.outOfRange;
      comparison = { comp_median: benchmark, projected_bid: bid, delta_pct: r.deltaPct };
    }
    // One quote per (opportunity, sub, trade): update the existing row instead
    // of stacking duplicates, so the Call Workspace and this form stay in sync.
    const existing =
      q.subcontractorId != null
        ? await queryOne<{ id: string }>(
            `select id from quotes
              where opportunity_id=$1 and subcontractor_id=$2 and coalesce(trade,'')=coalesce($3,'')
              order by created_at desc limit 1`,
            [params.id, q.subcontractorId, q.trade ?? null]
          )
        : null;
    if (existing) {
      await query(
        `update quotes
            set quote_amount=$2, payment_terms=$3, notes=$4, is_out_of_range=$5, comparison_json=$6
          where id=$1`,
        [
          existing.id,
          amount,
          q.payment_terms ?? null,
          q.notes ?? null,
          outOfRange,
          comparison ? JSON.stringify(comparison) : null,
        ]
      );
    } else {
      await query(
        `insert into quotes (opportunity_id, subcontractor_id, trade, quote_amount, payment_terms, notes, is_out_of_range, comparison_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          params.id,
          q.subcontractorId ?? null,
          q.trade ?? null,
          amount,
          q.payment_terms ?? null,
          q.notes ?? null,
          outOfRange,
          comparison ? JSON.stringify(comparison) : null,
        ]
      );
    }
  }

  if (saved === 0) {
    return NextResponse.json(
      { error: rejected[0]?.reason ?? "No valid quotes provided.", rejected },
      { status: 400 }
    );
  }

  await query(`update opportunities set stage='quote_entry', human_action_required=false where id=$1`, [
    params.id,
  ]);
  await enqueue("bid-builder", { opportunityId: params.id });
  await logAgent({
    agent: "operator",
    action: "quote-entry",
    opportunityId: params.id,
    level: "info",
    message: `Operator ${auth.email} entered ${saved} quote(s), total $${subTotal.toLocaleString()}. Triggered Bid Builder.`,
  });

  return NextResponse.json({ ok: true, subTotal, saved, rejected, warnings });
}
