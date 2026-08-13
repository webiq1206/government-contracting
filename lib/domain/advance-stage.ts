/**
 * Moving a solicitation forward once the subcontractor pricing is actually in.
 *
 * The job here is as much about NOT advancing as advancing. A solicitation that
 * moves to bid building while a trade is unpriced, or while a reply is still
 * waiting for a human to read it, produces a bid with a hole in it. So the
 * assessment is conservative: every trade we solicited must be covered by a
 * real quote, and nothing about the replies may still be in question.
 */
import { query } from "../db";
import { logAgent } from "../logger";

export interface TradeCoverage {
  trade: string;
  /** A usable quote exists for this trade. */
  covered: boolean;
  /** Every sub approached for this trade said no, so it cannot be covered. */
  exhausted: boolean;
  quoteCount: number;
}

export interface AdvanceAssessment {
  canAdvance: boolean;
  /** Plain-English reasons the solicitation is being held, if any. */
  holds: string[];
  trades: TradeCoverage[];
  pendingReview: number;
}

/** Outcomes that mean this sub will not be pricing this trade. */
const NEGATIVE_STATES = ["declined", "unavailable", "not_a_fit", "no_response"];

/**
 * Decide whether a solicitation's quotes are complete enough to build a bid.
 *
 * Reads only; the caller decides what to do with the answer.
 */
export async function assessQuoteCompleteness(
  opportunityId: string
): Promise<AdvanceAssessment> {
  const rows = await query<{
    trade: string | null;
    total: string;
    negative: string;
    quote_count: string;
  }>(
    `select os.trade,
            count(*) as total,
            count(*) filter (where os.outreach_state = any($2)) as negative,
            (select count(*) from quotes q
              where q.opportunity_id = os.opportunity_id
                and coalesce(q.trade, '') = coalesce(os.trade, '')
                and q.quote_amount is not null) as quote_count
       from opportunity_subs os
      where os.opportunity_id = $1
      group by os.trade, os.opportunity_id`,
    [opportunityId, NEGATIVE_STATES]
  ).catch(() => []);

  const pendingRows = await query<{ n: string }>(
    `select count(*) as n from subcontractor_reply_events
      where opportunity_id = $1 and needs_review and reviewed_at is null`,
    [opportunityId]
  ).catch(() => [{ n: "0" }]);
  const pendingReview = Number(pendingRows[0]?.n ?? 0);

  const trades: TradeCoverage[] = rows.map((r) => {
    const quoteCount = Number(r.quote_count);
    return {
      trade: r.trade ?? "(unspecified)",
      covered: quoteCount > 0,
      exhausted: quoteCount === 0 && Number(r.negative) >= Number(r.total),
      quoteCount,
    };
  });

  const holds: string[] = [];
  if (trades.length === 0) {
    // Nothing was ever solicited, so there is no completeness to judge. Silent
    // advance here would build a bid with no subcontractor pricing at all.
    holds.push("No subcontractors have been approached yet.");
  }
  const uncovered = trades.filter((t) => !t.covered && !t.exhausted);
  if (uncovered.length > 0) {
    holds.push(
      `Still waiting on pricing for ${uncovered.map((t) => t.trade).join(", ")}.`
    );
  }
  const exhausted = trades.filter((t) => t.exhausted);
  if (exhausted.length > 0) {
    // Not a waiting problem: everyone said no. A person has to find more subs
    // or drop the scope, and advancing would hide that.
    holds.push(
      `Every subcontractor approached for ${exhausted
        .map((t) => t.trade)
        .join(", ")} is out. You need more options for that scope.`
    );
  }
  if (pendingReview > 0) {
    holds.push(
      `${pendingReview} repl${pendingReview === 1 ? "y is" : "ies are"} waiting for you to read ${pendingReview === 1 ? "it" : "them"}.`
    );
  }

  return { canAdvance: holds.length === 0, holds, trades, pendingReview };
}

export interface AdvanceResult {
  advanced: boolean;
  assessment: AdvanceAssessment;
  enqueue?: { agent: string; payload: Record<string, unknown> };
}

/**
 * Advance a solicitation from quote entry to bid building when its pricing is
 * complete.
 *
 * Only moves a record that is actually sitting in quote_entry: a solicitation
 * further along must never be dragged backwards, and one earlier in the
 * journey has other work outstanding.
 */
export async function advanceIfQuotesComplete(
  opportunityId: string
): Promise<AdvanceResult> {
  const assessment = await assessQuoteCompleteness(opportunityId);
  if (!assessment.canAdvance) return { advanced: false, assessment };

  // Conditional on the current stage inside the statement itself, so a
  // concurrent poll cannot advance the same record twice.
  const updated = await query<{ id: string }>(
    `update opportunities
        set stage = 'bid_building', updated_at = now()
      where id = $1 and stage = 'quote_entry'
      returning id`,
    [opportunityId]
  ).catch(() => []);

  if (updated.length === 0) return { advanced: false, assessment };

  await logAgent({
    agent: "reply-poll",
    action: "stage-advanced",
    opportunityId,
    level: "success",
    message: `All trades are priced, so this moved to Bid Building on its own. Covered: ${assessment.trades
      .filter((t) => t.covered)
      .map((t) => t.trade)
      .join(", ")}.`,
    reasoning: "Every solicited trade has at least one quote and no reply is awaiting review.",
  });

  return {
    advanced: true,
    assessment,
    enqueue: { agent: "bid-builder", payload: { opportunityId } },
  };
}
