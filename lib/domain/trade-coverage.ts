/**
 * Per-trade subcontractor coverage for one opportunity. Answers: who did we
 * find, who responded, who quoted, and which scopes still need work.
 */

export interface TradeCoverageInputSub {
  trade: string | null;
  outreach_state: string | null;
  emails_sent?: number;
  calls_logged?: number;
  responded_at?: string | null;
}

export interface TradeCoverageInputQuote {
  trade: string | null;
  quote_amount?: number | null;
  is_out_of_range?: boolean | null;
}

export interface TradeCoverageRow {
  trade: string;
  found: number;
  contacted: number;
  responded: number;
  quotes: number;
  followUpDue: number;
  declined: number;
  /** complete | in_progress | action_required | empty */
  status: "complete" | "in_progress" | "action_required" | "empty";
  statusLabel: string;
}

export interface TradeCoverageSummary {
  trades: TradeCoverageRow[];
  totals: {
    found: number;
    contacted: number;
    responded: number;
    quotes: number;
    followUpDue: number;
    uncovered: number;
  };
}

/** Successfully contacted: draft/send_failed are NOT contacted. */
const CONTACTED = new Set([
  "sent",
  "followed_up",
  "responsive",
  "unresponsive",
  "declined",
]);

/**
 * Human follow-up due: automation already sent the initial email (and usually
 * the 48h follow-up). Fresh "sent" is still owned by the auto follow-up sweep.
 * Draft/send_failed need operator attention via Integrations / retry, not a
 * polite nudge call.
 */
const FOLLOW_UP_DUE = new Set(["followed_up", "unresponsive"]);

function normalizeTrade(t: string | null | undefined): string {
  const s = (t ?? "").trim();
  return s.length > 0 ? s : "General";
}

export function summarizeTradeCoverage(input: {
  requiredTrades?: string[] | null;
  subs: TradeCoverageInputSub[];
  quotes: TradeCoverageInputQuote[];
}): TradeCoverageSummary {
  const tradeKeys = new Set<string>();
  for (const t of input.requiredTrades ?? []) {
    if (t?.trim()) tradeKeys.add(t.trim());
  }
  for (const s of input.subs) tradeKeys.add(normalizeTrade(s.trade));
  for (const q of input.quotes) tradeKeys.add(normalizeTrade(q.trade));

  // Prefer required-trade order, then alpha for extras.
  const ordered = [
    ...(input.requiredTrades ?? []).map((t) => t.trim()).filter(Boolean),
    ...[...tradeKeys].filter((t) => !(input.requiredTrades ?? []).includes(t)).sort(),
  ];
  const seen = new Set<string>();
  const trades: TradeCoverageRow[] = [];

  for (const trade of ordered) {
    if (seen.has(trade)) continue;
    seen.add(trade);
    const subs = input.subs.filter((s) => normalizeTrade(s.trade) === trade);
    const quotes = input.quotes.filter(
      (q) => normalizeTrade(q.trade) === trade && Number(q.quote_amount) > 0
    );
    const found = subs.length;
    const contacted = subs.filter((s) => CONTACTED.has(s.outreach_state ?? "")).length;
    const responded = subs.filter((s) => s.outreach_state === "responsive" || s.responded_at).length;
    const declined = subs.filter((s) => s.outreach_state === "declined").length;
    const followUpDue = subs.filter((s) => FOLLOW_UP_DUE.has(s.outreach_state ?? "")).length;
    const quoteCount = quotes.length;

    let status: TradeCoverageRow["status"];
    let statusLabel: string;
    if (found === 0) {
      status = "empty";
      statusLabel = "Action required: no subs found";
    } else if (quoteCount > 0) {
      status = "complete";
      statusLabel = "Complete: quote on file";
    } else if (contacted === 0) {
      status = "action_required";
      statusLabel = "Action required: not contacted yet";
    } else if (followUpDue > 0 && responded === 0) {
      status = "action_required";
      statusLabel = "Action required: awaiting response";
    } else {
      status = "in_progress";
      statusLabel = "In progress: awaiting pricing";
    }

    trades.push({
      trade,
      found,
      contacted,
      responded,
      quotes: quoteCount,
      followUpDue,
      declined,
      status,
      statusLabel,
    });
  }

  const totals = {
    found: trades.reduce((a, t) => a + t.found, 0),
    contacted: trades.reduce((a, t) => a + t.contacted, 0),
    responded: trades.reduce((a, t) => a + t.responded, 0),
    quotes: trades.reduce((a, t) => a + t.quotes, 0),
    followUpDue: trades.reduce((a, t) => a + t.followUpDue, 0),
    uncovered: trades.filter((t) => t.status === "empty" || (t.quotes === 0 && t.found === 0)).length,
  };
  // Uncovered = trades with zero quotes that still need pricing.
  totals.uncovered = trades.filter((t) => t.quotes === 0).length;

  return { trades, totals };
}
