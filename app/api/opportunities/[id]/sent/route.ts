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
