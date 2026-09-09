import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { query, queryOne, transaction } from "@/lib/db";
import {
  applyOutcomeToSolicitation,
  OUTCOME_LABEL,
  type OutcomeApplied,
  type ReplyOutcome,
} from "@/lib/domain/reply-outcome";
import { logAgent } from "@/lib/logger";
import type { ExtractedReply } from "@/lib/ai/reply-extract";
import { proposeRow, type QuoteProposal } from "@/lib/domain/quote-fields";
import { saveProposedRow } from "@/lib/pricing-rows";
import { closeOutDeclinedSub } from "@/lib/domain/decline-closeout";
import {
  advanceIfQuotesComplete,
  closeIfSubsExhausted,
} from "@/lib/domain/advance-stage";
import { enqueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: ReplyOutcome[] = [
  "quoted",
  "interested",
  "declined",
  "unavailable",
  "not_a_fit",
  "needs_info",
  "partial_scope",
  "needs_time",
  "wrong_contact",
  "referred",
  "does_not_perform_trade",
  "none",
];

interface ReviewEvent {
  id: string;
  subcontractor_id: string;
  opportunity_id: string | null;
  trade: string | null;
  extracted: ExtractedReply | null;
  created_at: Date;
  needs_review: boolean;
  reviewed_at: Date | null;
}

interface TradePair {
  trade: string | null;
}

function isAllowedOutcome(value: unknown): value is ReplyOutcome {
  return typeof value === "string" && ALLOWED.includes(value as ReplyOutcome);
}

/**
 * Find the reply only when the event, its subcontractor, and its optional
 * opportunity all belong to this account. Historical events can have a null
 * org_id, so those are owned through both linked records instead.
 */
async function ownedReviewEvent(
  id: string,
  orgId: string,
): Promise<ReviewEvent | null> {
  return queryOne<ReviewEvent>(
    `select e.id, e.subcontractor_id, e.opportunity_id, e.trade,
            e.extracted, e.created_at, e.needs_review, e.reviewed_at
       from subcontractor_reply_events e
       join subcontractors s
         on s.id = e.subcontractor_id and s.org_id = $2
       left join opportunities o
         on o.id = e.opportunity_id and o.org_id = $2
      where e.id = $1
        and (e.org_id = $2 or e.org_id is null)
        and (e.opportunity_id is null or o.id is not null)`,
    [id, orgId],
  );
}

function tradeLabel(trade: string | null): string {
  return trade?.trim() || "the unlabelled trade";
}

class ReviewConflict extends Error {
  constructor(readonly response: NextResponse) {
    super("Reply review conflict");
    this.name = "ReviewConflict";
  }
}

/**
 * Resolve a flagged reply.
 *
 * The operator's decision follows the same quote proposal and solicitation
 * status paths as automatic reply capture. This endpoint never sends email.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireCapability("outreach");
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    outcome?: unknown;
    trade?: unknown;
  };
  if (!isAllowedOutcome(body.outcome)) {
    return NextResponse.json(
      { error: "Choose what the reply means." },
      { status: 400 },
    );
  }
  const outcome = body.outcome;
  const tradeWasProvided = Object.prototype.hasOwnProperty.call(body, "trade");
  if (
    tradeWasProvided &&
    body.trade !== null &&
    typeof body.trade !== "string"
  ) {
    return NextResponse.json(
      { error: "Choose a valid trade." },
      { status: 400 },
    );
  }
  const requestedTrade =
    typeof body.trade === "string"
      ? body.trade.trim() || null
      : body.trade === null
        ? null
        : null;

  const row = await ownedReviewEvent(params.id, orgId);
  if (!row) {
    return NextResponse.json({ error: "Reply not found." }, { status: 404 });
  }
  if (!row.needs_review || row.reviewed_at) {
    return NextResponse.json(
      {
        code: "already_reviewed",
        error:
          "This reply has already been reviewed. Refresh the list to see its current status.",
      },
      { status: 409 },
    );
  }
  if (outcome === "quoted" && !row.opportunity_id) {
    return NextResponse.json(
      {
        code: "quote_not_recordable",
        error:
          "A quote cannot be recorded because this reply is not linked to a solicitation. Nothing was marked quoted.",
      },
      { status: 422 },
    );
  }

  let appliedTrade = row.trade;
  let pairs: TradePair[] = [];
  if (row.opportunity_id && outcome !== "none") {
    pairs = await query<TradePair>(
      `select distinct os.trade
         from opportunity_subs os
         join opportunities o
           on o.id = os.opportunity_id and o.org_id = $3
         join subcontractors s
           on s.id = os.subcontractor_id and s.org_id = $3
        where os.opportunity_id = $1 and os.subcontractor_id = $2
          and os.removed_at is null
        order by os.trade nulls last`,
      [row.opportunity_id, row.subcontractor_id, orgId],
    );

    if (row.trade !== null) {
      if (tradeWasProvided && requestedTrade !== row.trade) {
        return NextResponse.json(
          {
            code: "trade_mismatch",
            error: `This reply is already linked to ${tradeLabel(row.trade)}. Nothing was changed.`,
          },
          { status: 409 },
        );
      }
      if (!pairs.some((pair) => pair.trade === row.trade)) {
        return NextResponse.json(
          {
            code: "pairing_removed",
            error:
              "That subcontractor is no longer active for this trade. Nothing was changed.",
          },
          { status: 409 },
        );
      }
    } else if (tradeWasProvided) {
      if (!pairs.some((pair) => pair.trade === requestedTrade)) {
        return NextResponse.json(
          {
            code: "pairing_removed",
            error:
              "That subcontractor is no longer active for the selected trade. Nothing was changed.",
          },
          { status: 409 },
        );
      }
      appliedTrade = requestedTrade;
    } else if (pairs.length === 1) {
      appliedTrade = pairs[0]!.trade;
    } else if (pairs.length === 0) {
      return NextResponse.json(
        {
          code: "pairing_removed",
          error:
            "That subcontractor is no longer active on this opportunity. Nothing was changed.",
        },
        { status: 409 },
      );
    } else {
      return NextResponse.json(
        {
          code: "trade_required",
          error:
            "Choose the trade this reply applies to, then save the review again.",
          candidateTrades: pairs.map((pair) => pair.trade),
        },
        { status: 409 },
      );
    }
  }

  const extracted = (row.extracted ?? {}) as ExtractedReply;
  const receivedAt = new Date(row.created_at);
  const safeReceivedAt = Number.isNaN(receivedAt.getTime())
    ? new Date()
    : receivedAt;
  let proposal: QuoteProposal | null = null;
  if (outcome === "quoted") {
    try {
      // Choosing "quoted" confirms the classification, but never invents an
      // amount or waives the proposal pipeline's other safety checks.
      proposal = proposeRow(
        { ...extracted, isQuote: true },
        {
          trade: appliedTrade,
          pairedTrades: pairs.map((pair) => pair.trade ?? "").filter(Boolean),
          receivedAt: safeReceivedAt,
        },
      );
    } catch {
      proposal = {
        ok: false,
        refusal: "no_amount",
        message: "No usable price was extracted from this reply.",
      };
    }
    if (!proposal.ok) {
      return NextResponse.json(
        {
          code: "quote_not_usable",
          error:
            `${proposal.message} Nothing was marked quoted. ` +
            "Choose another outcome, or enter the verified price on the opportunity and dismiss this review.",
        },
        { status: 422 },
      );
    }
  }

  let quoteSaved = false;
  let quoteSkippedExisting = false;
  let outcomeFollowUp: OutcomeApplied["enqueue"];
  try {
    await transaction(async (client) => {
      // A row lock lasts only for this transaction. A second tab waits, then
      // sees the completed timestamp and exits before repeating any effects.
      // If this process exits, PostgreSQL releases the lock and leaves the
      // review open instead of stranding it as falsely completed.
      const locked = await client.query<ReviewEvent>(
        `select e.id, e.subcontractor_id, e.opportunity_id, e.trade,
                e.extracted, e.created_at, e.needs_review, e.reviewed_at
           from subcontractor_reply_events e
           join subcontractors s
             on s.id = e.subcontractor_id and s.org_id = $2
           left join opportunities o
             on o.id = e.opportunity_id and o.org_id = $2
          where e.id = $1
            and (e.org_id = $2 or e.org_id is null)
            and (e.opportunity_id is null or o.id is not null)
          for update of e`,
        [row.id, orgId],
      );
      const current = locked.rows[0];
      if (!current) {
        throw new ReviewConflict(
          NextResponse.json({ error: "Reply not found." }, { status: 404 }),
        );
      }
      if (!current.needs_review || current.reviewed_at) {
        throw new ReviewConflict(
          NextResponse.json(
            {
              code: "already_reviewed",
              error:
                "This reply has already been reviewed in another tab. Refresh the list to see its current status.",
            },
            { status: 409 },
          ),
        );
      }
      if (
        current.subcontractor_id !== row.subcontractor_id ||
        current.opportunity_id !== row.opportunity_id ||
        current.trade !== row.trade
      ) {
        throw new ReviewConflict(
          NextResponse.json(
            {
              code: "reply_link_changed",
              error:
                "This reply's solicitation or trade changed while you were reviewing it. Refresh the page before saving a decision.",
            },
            { status: 409 },
          ),
        );
      }

      if (row.opportunity_id && outcome !== "none") {
        const activePair = await client.query<{ id: string }>(
          `select os.id
             from opportunity_subs os
             join opportunities o
               on o.id = os.opportunity_id and o.org_id = $4
             join subcontractors s
               on s.id = os.subcontractor_id and s.org_id = $4
            where os.opportunity_id = $1 and os.subcontractor_id = $2
              and coalesce(os.trade, '') = coalesce($3::text, '')
              and os.removed_at is null
            for update of os`,
          [row.opportunity_id, row.subcontractor_id, appliedTrade, orgId],
        );
        if (!activePair.rows[0]) {
          throw new ReviewConflict(
            NextResponse.json(
              {
                code: "pairing_removed",
                error:
                  "That subcontractor is no longer active for this trade. Nothing was changed. Refresh the review list.",
              },
              { status: 409 },
            ),
          );
        }

        if (outcome === "quoted" && proposal?.ok) {
          const notes = [
            "Confirmed by an operator from a reviewed email reply.",
            extracted.notes ?? "",
          ]
            .filter(Boolean)
            .join(" ");
          const insertedQuote =
            (
              await client.query<{ id: string }>(
                `insert into quotes
               (org_id, opportunity_id, subcontractor_id, trade, quote_amount,
                payment_terms, notes)
             values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (opportunity_id, subcontractor_id, (coalesce(trade,'')))
             do nothing
             returning id`,
                [
                  orgId,
                  row.opportunity_id,
                  row.subcontractor_id,
                  proposal.row.trade,
                  proposal.row.baseQuote,
                  proposal.row.paymentTerms,
                  notes,
                ],
              )
            ).rows[0] ?? null;
          quoteSaved = insertedQuote !== null;
          quoteSkippedExisting = insertedQuote === null;
          const sourceQuote =
            insertedQuote ??
            (
              await client.query<{ id: string }>(
                `select q.id
                 from quotes q
                 join opportunities o
                   on o.id = q.opportunity_id and o.org_id = $4
                 join subcontractors s
                   on s.id = q.subcontractor_id and s.org_id = $4
                where q.opportunity_id = $1 and q.subcontractor_id = $2
                  and coalesce(q.trade, '') = coalesce($3, '')
                  and (q.org_id = $4 or q.org_id is null)
                order by q.created_at asc
                limit 1`,
                [
                  row.opportunity_id,
                  row.subcontractor_id,
                  proposal.row.trade,
                  orgId,
                ],
              )
            ).rows[0] ??
            null;
          if (!sourceQuote) {
            throw new Error(
              "The quote was detected but its stored record could not be loaded.",
            );
          }
          if (insertedQuote) {
            await client.query(
              `update opportunity_subs os
                  set quoted_at = coalesce(os.quoted_at, $4::timestamptz),
                      quote_full_scope = coalesce(os.quote_full_scope, true)
                 from opportunities o, subcontractors s
                where os.opportunity_id = $1 and os.subcontractor_id = $2
                  and coalesce(os.trade, '') = coalesce($3, '')
                  and os.removed_at is null
                  and o.id = os.opportunity_id and o.org_id = $5
                  and s.id = os.subcontractor_id and s.org_id = $5`,
              [
                row.opportunity_id,
                row.subcontractor_id,
                proposal.row.trade,
                safeReceivedAt,
                orgId,
              ],
            );
          }
          // Run this for both a new quote and a prior idempotent insert. If a
          // request stopped after the quote insert but before structured price
          // fields were saved, retrying the still-open review repairs the
          // partial operation instead of permanently skipping those fields.
          const pricingResult = await saveProposedRow(
            {
              orgId,
              opportunityId: row.opportunity_id,
              subcontractorId: row.subcontractor_id,
              sourceQuoteId: sourceQuote.id,
              proposal: proposal.row,
              onlyIfAbsent: true,
            },
            client,
          );
          if (pricingResult === "not_editable") {
            throw new ReviewConflict(
              NextResponse.json(
                {
                  code: "pricing_not_editable",
                  error:
                    "The price could not be added because this solicitation is no longer editable. Nothing was marked quoted. Refresh the solicitation before trying again.",
                },
                { status: 409 },
              ),
            );
          }
        }

        if (outcome === "declined") {
          const capabilityNotes = [
            extracted.capabilityNotes,
            extracted.notes,
            extracted.tradesMentioned?.length
              ? `Trades mentioned: ${extracted.tradesMentioned.join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join(" ");
          await closeOutDeclinedSub(
            {
              orgId,
              opportunityId: row.opportunity_id,
              subcontractorId: row.subcontractor_id,
              trade: appliedTrade,
              source: "email_reply",
              capabilityNotes: capabilityNotes || null,
              sendThankYou: false,
            },
            { client, deferActivityLog: true },
          );
        } else {
          const applied = await applyOutcomeToSolicitation(
            {
              opportunityId: row.opportunity_id,
              subcontractorId: row.subcontractor_id,
              // Empty text targets the one unlabelled pairing through the
              // domain helper's coalesce comparison without asking it to infer
              // a trade from removed historical rows.
              trade: appliedTrade ?? "",
              outcome,
            },
            client,
          );
          if (!applied.applied) {
            throw new ReviewConflict(
              NextResponse.json(
                {
                  code: applied.refused ?? "outcome_not_applied",
                  error:
                    applied.refused === "ambiguous_trade"
                      ? `Choose one trade: ${applied.candidateTrades.join(", ")}. Nothing was changed.`
                      : "That outcome could not be applied. The review is still open.",
                  ...(applied.refused === "ambiguous_trade"
                    ? { candidateTrades: applied.candidateTrades }
                    : {}),
                },
                { status: 409 },
              ),
            );
          }
          outcomeFollowUp = applied.enqueue;
        }

        if (outcome === "partial_scope") {
          await client.query(
            `update opportunity_subs os
                set quote_full_scope = false
               from opportunities o, subcontractors s
              where os.opportunity_id = $1 and os.subcontractor_id = $2
                and coalesce(os.trade, '') = coalesce($3, '')
                and os.removed_at is null
                and o.id = os.opportunity_id and o.org_id = $4
                and s.id = os.subcontractor_id and s.org_id = $4`,
            [row.opportunity_id, row.subcontractor_id, appliedTrade, orgId],
          );
        }
      }

      const finalized = await client.query<{ id: string }>(
        `update subcontractor_reply_events
            set reviewed_at = now(), needs_review = false, intent = $2, trade = $3
          where id = $1 and reviewed_at is null and needs_review = true
          returning id`,
        [row.id, outcome, appliedTrade],
      );
      if (!finalized.rows[0])
        throw new Error("The locked review could not be finalized.");
    });
  } catch (error) {
    if (error instanceof ReviewConflict) return error.response;
    console.error("[reply-review] could not complete review", error);
    return NextResponse.json(
      {
        error:
          "The review could not be completed. Refresh the page to check its current status before trying again.",
      },
      { status: 500 },
    );
  }

  const followUpWarnings: string[] = [];
  const surfaceFollowUpFailure = async (summary: string, error: unknown) => {
    followUpWarnings.push(summary);
    console.error(`[reply-review] ${summary}`, error);
    if (row.opportunity_id) {
      await query(
        `update opportunities
            set human_action_required = true, updated_at = now()
          where id = $1 and org_id = $2`,
        [row.opportunity_id, orgId],
      ).catch((flagError) => {
        console.error(
          "[reply-review] could not flag the opportunity for attention",
          flagError,
        );
      });
    }
    await logAgent({
      agent: "reply-poll",
      action: "reply-review-followup-failed",
      opportunityId: row.opportunity_id ?? undefined,
      subcontractorId: row.subcontractor_id,
      level: "error",
      status: "error",
      message: `${summary} The review itself was saved and no email was sent. Open the solicitation and complete the next step manually.`,
    }).catch((logError) => {
      console.error(
        "[reply-review] could not persist the follow-up failure log",
        logError,
      );
    });
  };

  try {
    await logAgent({
      agent: "reply-poll",
      action: "reply-reviewed",
      opportunityId: row.opportunity_id ?? undefined,
      subcontractorId: row.subcontractor_id,
      level: "info",
      message: `You reviewed a flagged reply and recorded it as "${OUTCOME_LABEL[outcome]}" for this solicitation. No email was sent.`,
    });
  } catch (error) {
    followUpWarnings.push("The activity log could not be updated.");
    console.error(
      "[reply-review] could not persist the review activity log",
      error,
    );
  }

  if (outcomeFollowUp) {
    try {
      const jobId = await enqueue(
        outcomeFollowUp.agent,
        outcomeFollowUp.payload,
        outcomeFollowUp.opts,
      );
      if (!jobId) {
        await surfaceFollowUpFailure(
          "The partial-scope reply was saved, but replacement subcontractor work was not queued.",
          new Error("Queue returned no job identifier."),
        );
      }
    } catch (error) {
      await surfaceFollowUpFailure(
        "The partial-scope reply was saved, but replacement subcontractor work was not queued.",
        error,
      );
    }
  }

  if (row.opportunity_id && outcome === "quoted") {
    if (quoteSaved) {
      try {
        await query(
          `update opportunities
              set stage = 'quote_entry', human_action_required = false, updated_at = now()
            where id = $1 and org_id = $2 and stage in ('outreach','call_queue')`,
          [row.opportunity_id, orgId],
        );
      } catch (error) {
        await surfaceFollowUpFailure(
          "The quote was saved, but the solicitation stage could not be refreshed.",
          error,
        );
      }
    }
    try {
      const advanced = await advanceIfQuotesComplete(row.opportunity_id);
      if (advanced?.enqueue) {
        const jobId = await enqueue(
          advanced.enqueue.agent,
          advanced.enqueue.payload,
        );
        if (!jobId) {
          await surfaceFollowUpFailure(
            "All required quotes may be complete, but the next automation was not queued.",
            new Error("Queue returned no job identifier."),
          );
        }
      }
    } catch (error) {
      await surfaceFollowUpFailure(
        "The quote was saved, but completion and next-step automation could not be checked.",
        error,
      );
    }
  } else if (
    row.opportunity_id &&
    ["declined", "unavailable", "not_a_fit", "does_not_perform_trade"].includes(
      outcome,
    )
  ) {
    try {
      const exhaustion = await closeIfSubsExhausted(row.opportunity_id);
      if (exhaustion?.enqueue) {
        const jobId = await enqueue(
          exhaustion.enqueue.agent,
          exhaustion.enqueue.payload,
          exhaustion.enqueue.opts,
        );
        if (!jobId) {
          await surfaceFollowUpFailure(
            "The reply was saved, but replacement subcontractor work was not queued.",
            new Error("Queue returned no job identifier."),
          );
        }
      }
    } catch (error) {
      await surfaceFollowUpFailure(
        "The reply was saved, but subcontractor coverage could not be rechecked.",
        error,
      );
    }
  }

  let message: string;
  if (!row.opportunity_id) {
    message =
      "Review saved. No solicitation is linked, so no solicitation status was changed.";
  } else if (outcome === "none") {
    message =
      "Review dismissed. No solicitation or subcontractor status was changed.";
  } else if (outcome === "quoted" && proposal?.ok) {
    const price = `$${proposal.row.baseQuote.toLocaleString("en-US")}`;
    message = quoteSaved
      ? `Review saved. The extracted ${price} price was recorded for ${tradeLabel(appliedTrade)}.`
      : `Review saved. A quote was already on file for ${tradeLabel(appliedTrade)}, so it was kept unchanged.`;
  } else {
    message = `Review saved as ${OUTCOME_LABEL[outcome].toLowerCase()} for ${tradeLabel(appliedTrade)}.`;
  }
  message += " No email was sent.";
  if (followUpWarnings.length > 0) {
    message += ` Follow-up needed: ${followUpWarnings.join(" ")}`;
  }

  return NextResponse.json({
    ok: true,
    quoteSaved,
    quoteSkippedExisting,
    trade: appliedTrade,
    emailSent: false,
    followUpRequired: followUpWarnings.length > 0,
    warnings: followUpWarnings,
    message,
  });
}
