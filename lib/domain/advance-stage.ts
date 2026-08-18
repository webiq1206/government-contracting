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
import { PRE_QUOTE_STAGES, STAGE_AFTER_CALLS } from "./call-step";

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
// "unresponsive" is what the sweep actually writes after a dead follow-up.
// The old list said "no_response", which nothing writes, so a trade whose
// subs all went quiet never read as exhausted and sat "waiting" forever.
const NEGATIVE_STATES = ["declined", "unavailable", "not_a_fit", "unresponsive"];

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

/**
 * Move an opportunity past the call step because calling is turned off.
 *
 * Conditional on the current stage inside the statement, like every other
 * advance here, so two agents finishing outreach at the same moment cannot
 * both claim the move. The human-action flag is cleared with it: the flag's
 * only meaning at this point in the pipeline is "somebody has to make a
 * call", and leaving it set would park the record on Today asking for the
 * one thing this account has said it does not do.
 */
export async function advancePastCallStep(
  opportunityId: string,
  opts: { agent?: string; reason?: string } = {}
): Promise<boolean> {
  const moved = await query<{ id: string; stage: string }>(
    `update opportunities
        set stage = $2, human_action_required = false, updated_at = now()
      where id = $1 and stage = any($3)
      returning id, stage`,
    [opportunityId, STAGE_AFTER_CALLS, PRE_QUOTE_STAGES]
  ).catch(() => []);

  if (moved.length === 0) return false;

  await logAgent({
    agent: opts.agent ?? "operator",
    action: "call-step-skipped",
    opportunityId,
    level: "info",
    message:
      opts.reason ??
      "Calling is turned off, so this moved straight to collecting quotes after its outreach email.",
    reasoning:
      "Calls are disabled in Automation Rules; the call stage is skipped and no call card is prepared.",
  });

  return true;
}


export interface ExhaustionResult {
  /** What was done: nothing, another search queued, or the record closed. */
  action: "none" | "resourced" | "closed";
  exhaustedTrades: string[];
  enqueue?: { agent: string; payload: Record<string, unknown>; opts?: Record<string, unknown> };
}

/** Flag recording that the automatic second sub search has been spent. */
const RESOURCE_RETRY_FLAG = "sub_search_retried";
/** Flag naming why a closed record closed, for lists and the log. */
const NO_VIABLE_SUBS_FLAG = "no_viable_subs";

/**
 * Deal with a solicitation whose subcontractors have all said no.
 *
 * Escalation, in order, each step taken at most once:
 *
 *   1. Every approached sub for every trade is out and nothing is priced:
 *      run Sub Finder again. Declines change the picture, the roster grows,
 *      and a deeper search often has candidates the first pass ranked below
 *      the cut. This is the step a person would take, so the platform takes
 *      it first.
 *   2. The retry already happened and everyone still said no: close the
 *      record, with the reasoning written where the operator will read it.
 *      Leaving it open teaches the operator that "open" means nothing.
 *
 * Deliberately does NOTHING while any trade still has a live approach or a
 * quote: a partial exhaustion is a judgment call (bid without that scope?
 * find one more sub?) and stays with the human via the existing holds.
 */
export async function closeIfSubsExhausted(
  opportunityId: string
): Promise<ExhaustionResult> {
  const assessment = await assessQuoteCompleteness(opportunityId);
  const trades = assessment.trades;
  if (trades.length === 0) return { action: "none", exhaustedTrades: [] };

  const exhausted = trades.filter((t) => t.exhausted).map((t) => t.trade);
  const anyCovered = trades.some((t) => t.covered);
  const allExhausted = exhausted.length === trades.length;
  if (!allExhausted || anyCovered) return { action: "none", exhaustedTrades: exhausted };

  const opp = await query<{ id: string; risk_flags: string[] | null; status: string }>(
    `select id, risk_flags, status from opportunities where id = $1`,
    [opportunityId]
  ).catch(() => []);
  const record = opp[0];
  if (!record || record.status !== "open") {
    return { action: "none", exhaustedTrades: exhausted };
  }

  const flags = record.risk_flags ?? [];
  if (!flags.includes(RESOURCE_RETRY_FLAG)) {
    await query(
      `update opportunities
          set risk_flags = (
            select array(select distinct unnest(coalesce(risk_flags,'{}') || array[$2]))
          )
        where id = $1`,
      [opportunityId, RESOURCE_RETRY_FLAG]
    );
    await logAgent({
      agent: "reply-poll",
      action: "resourcing-subs",
      opportunityId,
      level: "warn",
      message: `Every subcontractor approached so far has declined or gone quiet (${exhausted.join(
        ", "
      )}). Running the sub search again automatically to find more candidates before giving up on this one.`,
      reasoning: "All approached pairings are in a negative state and no quote exists for any trade.",
    });
    return {
      action: "resourced",
      exhaustedTrades: exhausted,
      enqueue: {
        agent: "sub-finder",
        payload: { opportunityId },
        opts: { singletonKey: `resub:${opportunityId}`, singletonSeconds: 24 * 3600 },
      },
    };
  }

  // The second search already ran and its candidates have also all said no.
  const closed = await query<{ id: string }>(
    `update opportunities
        set stage = 'dismissed', status = 'archived', human_action_required = false,
            risk_flags = (
              select array(select distinct unnest(coalesce(risk_flags,'{}') || array[$2]))
            ),
            updated_at = now()
      where id = $1 and status = 'open'
      returning id`,
    [opportunityId, NO_VIABLE_SUBS_FLAG]
  ).catch(() => []);
  if (closed.length === 0) return { action: "none", exhaustedTrades: exhausted };

  await logAgent({
    agent: "reply-poll",
    action: "closed-no-subs",
    opportunityId,
    level: "warn",
    message: `Closed: no subcontractor can perform this work. Every firm approached for ${exhausted.join(
      ", "
    )} declined, was unavailable, or never responded, including a second round of sourcing. Reopen it from the board if you find a sub yourself.`,
    reasoning:
      "All approached pairings are negative for every trade, no quotes exist, and the automatic re-sourcing pass has already been used.",
  });
  return { action: "closed", exhaustedTrades: exhausted };
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
