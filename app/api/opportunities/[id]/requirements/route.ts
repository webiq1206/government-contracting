import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { validatePackage } from "@/lib/domain/package";
import { logAgent } from "@/lib/logger";
import type { Bid, Opportunity, ResolvedRequirement } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Toggle an operator-owned requirement (signature / operator-provided) as
 * complete. Re-runs validation and updates package_ready so the Submit gate
 * reflects reality immediately.
 * Body: { requirement_id: string, confirmed: boolean }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as {
    requirement_id?: string;
    confirmed?: boolean;
  };
  if (!body.requirement_id) {
    return NextResponse.json({ error: "requirement_id is required." }, { status: 400 });
  }

  const bid = await queryOne<
    Pick<Bid, "id" | "compliance_matrix" | "bid_amount" | "sub_quote_total" | "markup_pct">
  >(
    `select id, compliance_matrix, bid_amount, sub_quote_total, markup_pct
       from bids where opportunity_id=$1 order by created_at desc limit 1`,
    [params.id]
  );
  if (!bid || !bid.compliance_matrix) {
    return NextResponse.json({ error: "No package to update." }, { status: 400 });
  }
  const opp = await queryOne<Pick<Opportunity, "past_perf_classification">>(
    `select past_perf_classification from opportunities where id=$1`,
    [params.id]
  );

  const confirmed = body.confirmed !== false;
  let found = false;
  const matrix: ResolvedRequirement[] = bid.compliance_matrix.map((r) => {
    if (r.id !== body.requirement_id) return r;
    found = true;
    if (confirmed) {
      return { ...r, operator_confirmed: true, status: "satisfied" };
    }
    // Un-confirm: restore the derived status for its type.
    const status: ResolvedRequirement["status"] =
      r.satisfied_by === "operator_signature"
        ? "needs_signature"
        : r.satisfied_by === "operator_provided"
          ? "needs_operator"
          : "satisfied";
    return { ...r, operator_confirmed: false, status };
  });
  if (!found) {
    return NextResponse.json({ error: "Requirement not found in this package." }, { status: 404 });
  }

  const bidAmount = bid.bid_amount != null ? Number(bid.bid_amount) : null;
  const subtotal = bid.sub_quote_total != null ? Number(bid.sub_quote_total) : 0;
  const markup = bid.markup_pct != null ? Number(bid.markup_pct) : 0;
  const validation = validatePackage({
    resolved: matrix,
    hasIdentifiers: true, // profile identifiers already reflected at build time
    pricingReconciles:
      bidAmount == null ? false : Math.abs(bidAmount - subtotal * (1 + markup / 100)) < Math.max(1, bidAmount * 0.02),
    bidAmount,
    nowIso: new Date().toISOString(),
  });

  await query(
    `update bids set compliance_matrix=$2, package_ready=$3, validation_json=$4 where id=$1`,
    [bid.id, JSON.stringify(matrix), validation.passed, JSON.stringify(validation)]
  );
  await logAgent({
    agent: "operator",
    action: "requirement-confirm",
    opportunityId: params.id,
    bidId: bid.id,
    level: "info",
    message: `${confirmed ? "Marked complete" : "Reopened"}: ${body.requirement_id}. Package ${
      validation.passed ? "ready" : `has ${validation.blockers.length} blocker(s)`
    }.`,
  });

  return NextResponse.json({ ok: true, package_ready: validation.passed, validation });
}
