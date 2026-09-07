import { NextResponse } from "next/server";
import { requireOrgContext, notFoundResponse } from "@/lib/org-guard";
import { queryOne, transaction } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import { stopOpportunityAutomation } from "@/lib/close-opportunity-work";
import { submissionPackageHash } from "@/lib/bid-package-state";
import { sendProblem } from "@/lib/domain/opportunity-lifecycle";
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
import type { PackageItem } from "@/lib/types";

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
    documents_json: {
      name?: string;
      kind: string;
      storage_path: string;
      storage_backend?: string;
      content_hash?: string;
    }[] | null;
    package_manifest: PackageItem[] | null;
    stage: string;
    status: string;
    pursuit_state: string | null;
  }>(
    `select b.id, b.submission_state, b.documents_json, b.package_manifest,
            o.stage, o.status, o.pursuit_state
       from bids b join opportunities o on o.id = b.opportunity_id
      where b.opportunity_id = $1 and o.org_id = $2 and b.org_id = $2
      order by b.created_at desc limit 1`,
    [params.id, orgId]
  );
  if (!bid) return notFoundResponse();

  const lifecycleProblem = sendProblem({
    stage: bid.stage,
    status: bid.status,
    pursuitState: bid.pursuit_state,
    submissionState: bid.submission_state,
  });
  if (lifecycleProblem) {
    return NextResponse.json({ error: lifecycleProblem }, { status: 409 });
  }

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
  if (method === "connector") {
    return NextResponse.json(
      {
        error:
          "A connector delivery can be recorded only by the connector that holds the provider request and response. Choose the manual method you actually used, or retry the connector send from its integration.",
      },
      { status: 400 }
    );
  }
  if (body.sentAt && !/(?:z|[+-]\d{2}:\d{2})$/i.test(body.sentAt.trim())) {
    return NextResponse.json(
      {
        error:
          "Include the delivery time with its UTC offset, such as 2026-09-07T14:30:00-05:00. This prevents a timezone label from changing which instant was recorded.",
      },
      { status: 400 }
    );
  }
  if (sentAt && !Number.isNaN(sentAt.getTime()) && sentAt.getTime() > Date.now() + 5 * 60_000) {
    return NextResponse.json(
      { error: "The delivery time is in the future. Check the time and timezone, then try again." },
      { status: 400 }
    );
  }
  const timezone = body.timezone?.trim() ?? "";
  if (timezone && !isIanaTimezone(timezone)) {
    return NextResponse.json(
      { error: "Use a valid timezone such as America/Chicago or UTC." },
      { status: 400 }
    );
  }
  if (
    body.attestation != null &&
    body.attestation.trim().length > 0 &&
    body.attestation.trim().length < 10
  ) {
    return NextResponse.json(
      { error: "Briefly describe what you sent and what confirmation you saw." },
      { status: 400 }
    );
  }

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
          and (d.org_id = $3 or d.org_id is null)
          and d.kind in ('submission_proof','operator_upload')
          and coalesce(btrim(d.storage_path), '') <> ''`,
      [body.proofDocumentId.trim(), params.id, orgId]
    );
    if (!doc) {
      return NextResponse.json(
        {
          error:
            "That receipt is not a stored submission-proof upload on this opportunity. Upload the confirmation screen or email, then choose that file.",
        },
        { status: 400 }
      );
    }
    proofDocumentId = doc.id;
  }

  const packageIdentity = await submissionPackageHash({
    opportunityId: params.id,
    orgId,
    manifest: bid.package_manifest,
    documents: bid.documents_json,
  });
  if (!packageIdentity.hash) {
    return NextResponse.json(
      {
        error:
          packageIdentity.error ??
          "The exact package version could not be identified. Rebuild and review it before recording delivery.",
      },
      { status: 409 }
    );
  }

  const evidence: SentEvidence = {
    method,
    destination: body.destination ?? null,
    sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
    timezone: timezone || null,
    confirmationNumber: body.confirmationNumber?.trim() || null,
    proofDocumentId,
    attestation: body.attestation ?? null,
    // Which version of the package went. Without it, a package rebuilt after
    // an amendment is indistinguishable from the one that was uploaded.
    packageHash: packageIdentity.hash,
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

  const proof = proofSummary("sent", evidence);
  let transitioned = false;
  try {
    transitioned = await transaction(async (client) => {
      const changedBid = await client.query<{ id: string }>(
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
           outcome='pending',
           updated_at=now()
         where id=$1 and org_id=$11 and submission_state=$12
         returning id`,
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
          orgId,
          from,
        ]
      );
      if (changedBid.rows.length === 0) return false;

      const changedOpportunity = await client.query<{ id: string }>(
        `update opportunities
            set stage='submitted', human_action_required=false
          where id=$1 and org_id=$2 and stage='bid_building' and status='open'
            and coalesce(pursuit_state, 'active')='active'
          returning id`,
        [params.id, orgId]
      );
      if (changedOpportunity.rows.length === 0) {
        throw new Error("OPPORTUNITY_SEND_STATE_CHANGED");
      }

      await client.query(
        `insert into bid_submission_events (bid_id, org_id, from_state, to_state, actor, proof)
         values ($1,$2,$3,'sent',$4,$5)`,
        [bid.id, orgId, from, auth.email, proof]
      );
      return true;
    });
  } catch (error) {
    if ((error as Error).message !== "OPPORTUNITY_SEND_STATE_CHANGED") {
      await logAgent({
        agent: "operator",
        action: "bid-sent-failed",
        opportunityId: params.id,
        bidId: bid.id,
        level: "error",
        status: "error",
        message: `The delivery record transaction was rolled back: ${(error as Error).message}`,
      }).catch(() => {});
      return NextResponse.json(
        {
          error:
            "The delivery record could not be saved. Nothing was marked sent. Refresh the opportunity and try again after the database connection recovers.",
        },
        { status: 503 }
      );
    }
  }
  if (!transitioned) {
    return NextResponse.json(
      {
        error:
          "The bid changed before the send record was saved. Refresh it and verify its current submission state.",
      },
      { status: 409 }
    );
  }

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
  const warnings: string[] = [];
  const snapshotWarning = await freezeSentCalculation(params.id, orgId, bid.id, auth.email);
  if (snapshotWarning) warnings.push(snapshotWarning);
  await stopOpportunityAutomation(orgId, [params.id], "submitted").catch(async (error: unknown) => {
    const warning =
      "Delivery was recorded, but pending subcontractor follow-ups could not be cleared. Pause automation and contact support.";
    warnings.push(warning);
    await logAgent({
      agent: "operator",
      action: "submission-cleanup-failed",
      opportunityId: params.id,
      bidId: bid.id,
      level: "error",
      status: "error",
      message: `${warning} ${(error as Error).message}`,
    }).catch(() => {});
  });
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

  return NextResponse.json({ ok: true, state: "sent", proof, warnings });
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * The pricing as it stood when the package left.
 *
 * A failure cannot undo a send that already happened in the real world. It is
 * returned as a visible warning and written as an error log, while the atomic
 * submission event remains the authoritative delivery record.
 */
async function freezeSentCalculation(
  opportunityId: string,
  orgId: string,
  bidId: string,
  actor: string
): Promise<string | null> {
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
      `select bid_amount from bids where id = $1 and org_id = $2`,
      [bidId, orgId]
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
    return null;
  } catch (error) {
    const warning =
      "Delivery was recorded, but the sent-pricing snapshot could not be saved. Review the submission event and contact support.";
    await logAgent({
      agent: "operator",
      action: "sent-pricing-snapshot-failed",
      opportunityId,
      bidId,
      level: "error",
      status: "error",
      message: `${warning} ${(error as Error).message}`,
    }).catch(() => {});
    return warning;
  }
}
