import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { validatePackage, computeReady } from "@/lib/domain/package";
import { logAgent } from "@/lib/logger";
import type { Bid, AuditFinding, ResolvedRequirement } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark an operator item complete. Either a compliance requirement (signature /
 * provided doc) or an audit finding (acknowledge). Re-runs validation +
 * combined readiness so the Submit gate reflects reality immediately.
 * Body: { requirement_id?: string, finding_id?: string, confirmed: boolean }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as {
    requirement_id?: string;
    finding_id?: string;
    confirmed?: boolean;
  };
  if (!body.requirement_id && !body.finding_id) {
    return NextResponse.json(
      { error: "requirement_id or finding_id is required." },
      { status: 400 }
    );
  }

  const bid = await queryOne<
    Pick<
      Bid,
      | "id"
      | "compliance_matrix"
      | "audit_findings"
      | "bid_amount"
      | "sub_quote_total"
      | "markup_pct"
    >
  >(
    `select id, compliance_matrix, audit_findings, bid_amount, sub_quote_total, markup_pct
       from bids where opportunity_id=$1 order by created_at desc limit 1`,
    [params.id]
  );
  if (!bid || !bid.compliance_matrix) {
    return NextResponse.json({ error: "No package to update." }, { status: 400 });
  }

  const confirmed = body.confirmed !== false;
  let matrix: ResolvedRequirement[] = bid.compliance_matrix;
  let findings: AuditFinding[] = bid.audit_findings ?? [];
  let label = "";

  if (body.requirement_id) {
    let found = false;
    matrix = matrix.map((r) => {
      if (r.id !== body.requirement_id) return r;
      found = true;
      if (confirmed) return { ...r, operator_confirmed: true, status: "satisfied" };
      const status: ResolvedRequirement["status"] = r.official_form
        ? "needs_operator"
        : r.satisfied_by === "operator_signature"
          ? "needs_signature"
          : r.satisfied_by === "operator_provided"
            ? "needs_operator"
            : "satisfied";
      return { ...r, operator_confirmed: false, status };
    });
    if (!found) {
      return NextResponse.json({ error: "Requirement not found." }, { status: 404 });
    }
    label = `requirement ${body.requirement_id}`;
  }

  if (body.finding_id) {
    let found = false;
    findings = findings.map((f) => {
      if (f.id !== body.finding_id) return f;
      found = true;
      return { ...f, acknowledged: confirmed };
    });
    if (!found) {
      return NextResponse.json({ error: "Finding not found." }, { status: 404 });
    }
    label = `audit finding ${body.finding_id}`;
  }

  const bidAmount = bid.bid_amount != null ? Number(bid.bid_amount) : null;
  const subtotal = bid.sub_quote_total != null ? Number(bid.sub_quote_total) : 0;
  const markup = bid.markup_pct != null ? Number(bid.markup_pct) : 0;
  const validation = validatePackage({
    resolved: matrix,
    hasIdentifiers: true,
    pricingReconciles:
      bidAmount == null
        ? false
        : Math.abs(bidAmount - subtotal * (1 + markup / 100)) < Math.max(1, bidAmount * 0.02),
    bidAmount,
    nowIso: new Date().toISOString(),
  });
  const ready = computeReady(validation, findings);

  await query(
    `update bids
        set compliance_matrix=$2, audit_findings=$3, package_ready=$4, validation_json=$5
      where id=$1`,
    [bid.id, JSON.stringify(matrix), JSON.stringify(findings), ready, JSON.stringify(validation)]
  );
  await logAgent({
    agent: "operator",
    action: "requirement-confirm",
    opportunityId: params.id,
    bidId: bid.id,
    level: "info",
    message: `${confirmed ? "Marked complete" : "Reopened"}: ${label}. Package ${
      ready ? "ready" : "not ready"
    }.`,
  });

  return NextResponse.json({ ok: true, package_ready: ready, validation });
}
