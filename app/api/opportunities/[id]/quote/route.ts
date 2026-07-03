import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { getProfileJson } from "@/lib/ai/companyProfile";
import { bidForTargetMargin, isOutOfRange } from "@/lib/domain/pricing";
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
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const items: QuoteInput[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "No quotes provided." }, { status: 400 });
  }

  const opp = await queryOne<Opportunity>(`select * from opportunities where id=$1`, [params.id]);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const profile = await getProfileJson();

  const pricingSummary = (opp.raw_json as { pricing_summary?: { median?: number } } | null)
    ?.pricing_summary;
  const tolerance = profile?.pricing_rules.out_of_range_tolerance_pct ?? 20;

  let subTotal = 0;
  for (const q of items) {
    const amount = Number(q.quote_amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    subTotal += amount;
    let outOfRange = false;
    let comparison: Record<string, unknown> | null = null;
    if (pricingSummary?.median) {
      const bid = bidForTargetMargin(amount, profile?.target_margin_pct ?? 20);
      const r = isOutOfRange(bid, pricingSummary.median, tolerance);
      outOfRange = r.outOfRange;
      comparison = { comp_median: pricingSummary.median, projected_bid: bid, delta_pct: r.deltaPct };
    }
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

  await query(`update opportunities set stage='quote_entry', human_action_required=false where id=$1`, [
    params.id,
  ]);
  await enqueue("bid-builder", { opportunityId: params.id });
  await logAgent({
    agent: "operator",
    action: "quote-entry",
    opportunityId: params.id,
    level: "info",
    message: `Operator ${auth.email} entered ${items.length} quote(s), total ${subTotal}. Triggered Bid Builder.`,
  });

  return NextResponse.json({ ok: true, subTotal });
}
