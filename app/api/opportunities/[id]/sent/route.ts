import { NextResponse } from "next/server";
import { requireOrgContext, notFoundResponse } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import {
  canSubmit,
  describeGaps,
  parseSubmissionState,
  proofSummary,
  sentEvidenceGaps,
  SUBMISSION_METHODS,
  type SentEvidence,
  type SubmissionMethod,
} from "@/lib/domain/submission-state";
import { freezeCalculation, pricingRowsWithQuotes } from "@/lib/pricing-rows";
import { pricingSheet } from "@/lib/domain/pricing-row";
import { bidMath, explainBidMath } from "@/lib/domain/trade-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record that the package reached the agency, and what proves it.
 *
 * POST /api/opportunities/[id]/sent
 *
 * This is the endpoint that sets `submitted_at`, and it is the only one. The
 * submit endpoint approves a package; it cannot claim delivery, because for
 * almost every solicitation here the delivery is a person uploading files to a
 * government portal in another application.
 *
 * Everything below is a refusal to write a confident state on somebody's
 * memory of having done it.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "submit" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const bid = await queryOne<{
    id: string;
    submission_state: string;
    requirements_fingerprint: string | null;
  }>(
    `select b.id, b.submission_state, b.requirements_fingerprint
       from bids b join opportunities o on o.id = b.opportunity_id
      where b.opportunity_id = $1 and o.org_id = $2
      order by b.created_at desc limit 1`,
    [params.id, orgId]
  );
  if (!bid) return notFoundResponse();

  const body = (await req.json().catch(() => ({}))) as {
    method?: string;
    destination?: string;
    sentAt?: string;
    timezone?: string;
    confirmationNumber?: string;
    proofDocumentId?: string;
    attestation?: string;
  };

  const method = (SUBMISSION_METHODS as readonly string[]).includes(body.method ?? "")
    ? (body.method as SubmissionMethod)
    : null;
  const sentAt = body.sentAt ? new Date(body.sentAt) : null;

  /*
   * The proof document has to be one of this account's, and one attached to
   * this opportunity. A document id in a request body proves nothing, and a
   * receipt from a different bid is not evidence about this one.
   */
  let proofDocumentId: string | null = null;
  if (body.proofDocumentId?.trim()) {
    const doc = await queryOne<{ id: string }>(
      `select d.id from documents d
        where d.id = $1 and d.opportunity_id = $2
          and (d.org_id = $3 or d.org_id is null)`,
      [body.proofDocumentId.trim(), params.id, orgId]
    );
    if (!doc) {
      return NextResponse.json(
        { error: "That receipt is not a document on this opportunity." },
        { status: 400 }
      );
    }
    proofDocumentId = doc.id;
  }

  const evidence: SentEvidence = {
    method,
    destination: body.destination ?? null,
    sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
    timezone: body.timezone ?? null,
    confirmationNumber: body.confirmationNumber?.trim() || null,
    proofDocumentId,
    attestation: body.attestation ?? null,
    // Which version of the package went. Without it, a package rebuilt after
    // an amendment is indistinguishable from the one that was uploaded.
    packageHash: bid.requirements_fingerprint,
  };

  const gaps = sentEvidenceGaps(evidence);
  if (gaps.length > 0) {
    return NextResponse.json(
      { error: describeGaps(gaps), gaps },
      { status: 400 }
    );
  }

  const from = parseSubmissionState(bid.submission_state);
  if (!canSubmit(from, "sent")) {
    return NextResponse.json(
      {
        error:
          from === "package_ready"
            ? "Approve the package first. Nothing should leave here before the checks have passed."
            : `A bid that is ${from.replace(/_/g, " ")} cannot be marked as sent.`,
      },
      { status: 409 }
    );
  }

  await query(
    `update bids set
       submission_state='sent',
       submitted_at=$2,
       submission_method=$3,
       submission_destination=$4,
       sent_timezone=$5,
       confirmation_number=$6,
       proof_document_id=$7,
       submission_attestation=$8,
       submitted_by=$9,
       submitted_package_hash=$10,
       outcome='pending'
     where id=$1`,
    [
      bid.id,
      evidence.sentAt,
      evidence.method,
      evidence.destination?.trim(),
      evidence.timezone?.trim(),
      evidence.confirmationNumber,
      evidence.proofDocumentId,
      evidence.attestation?.trim(),
      auth.email,
      evidence.packageHash,
    ]
  );

  /*
   * Freeze the arithmetic that actually went out.
   *
   * Approval already wrote a snapshot, and this is deliberately a second one
   * rather than a reuse of it: a package can be approved on Tuesday, have a
   * quote re-confirmed on Wednesday, and be sent on Thursday. What a
   * contracting officer received is what the numbers were at the moment of
   * sending, and the two snapshots side by side are the record of anything
   * that moved in between.
   */
  await freezeSentCalculation(params.id, orgId, bid.id, auth.email);

  const proof = proofSummary("sent", evidence);
  await query(
    `insert into bid_submission_events (bid_id, org_id, from_state, to_state, actor, proof)
     values ($1,$2,$3,'sent',$4,$5)`,
    [bid.id, orgId, from, auth.email, proof]
  ).catch(() => {});

  await query(
    `update opportunities set stage='submitted', human_action_required=false where id=$1`,
    [params.id]
  );
  await logAgent({
    agent: "operator",
    action: "bid-sent",
    opportunityId: params.id,
    bidId: bid.id,
    level: "success",
    // The audit line says what is proven, not what the state is called.
    message: `${auth.email} recorded the package as sent: ${proof}`,
    reasoning:
      "The agency has not acknowledged it yet. A follow-up is owed until a receipt is recorded.",
  });

  return NextResponse.json({ ok: true, state: "sent", proof });
}

/**
 * The pricing as it stood when the package left.
 *
 * Failure here is swallowed on purpose. Losing the frozen copy is bad; failing
 * a send that has already happened in the real world, because a second insert
 * failed, is worse, and the submission event and audit line are written either
 * way.
 */
async function freezeSentCalculation(
  opportunityId: string,
  orgId: string,
  bidId: string,
  actor: string
): Promise<void> {
  try {
    const opp = await queryOne<{
      deadline: Date | null;
      solicitation_analysis: { required_trades?: string[] } | null;
    }>(
      `select deadline, solicitation_analysis from opportunities where id = $1 and org_id = $2`,
      [opportunityId, orgId]
    );
    const required = (opp?.solicitation_analysis?.required_trades ?? [])
      .map((t) => String(t).trim())
      .filter(Boolean);
    const rows = await pricingRowsWithQuotes(opportunityId, orgId);
    const sheet = pricingSheet(required, rows, {
      now: new Date(),
      bidDueAt: opp?.deadline ? new Date(opp.deadline) : null,
    });
    const bidRow = await queryOne<{ bid_amount: string | null }>(
      `select bid_amount from bids where id = $1`,
      [bidId]
    );
    const bidAmount =
      bidRow?.bid_amount != null && Number.isFinite(Number(bidRow.bid_amount))
        ? Number(bidRow.bid_amount)
        : null;
    const math = bidMath({ cost: sheet.cost, bid: bidAmount, contingencyPct: null });
    await freezeCalculation({
      bidId,
      orgId,
      opportunityId,
      reason: "sent",
      actor,
      calculation: {
        cost: sheet.cost,
        bid: bidAmount,
        grossProfit: math.grossProfit,
        marginPct: math.marginPct,
        markupPct: math.markupPct,
        formula: explainBidMath(math),
        weakestConfidence: sheet.weakestConfidence,
        rows: sheet.rows.map((p) => ({
          trade: p.row.trade,
          scopeKey: p.row.scopeKey,
          selectedSub: p.row.selectedSubName ?? null,
          baseQuote: p.row.baseQuote,
          total: p.total,
          confidence: p.row.confidence,
          quoteExpiresOn: p.row.quoteExpiresOn,
        })),
      },
    });
  } catch {
    // Deliberately silent: see the note above.
  }
}
