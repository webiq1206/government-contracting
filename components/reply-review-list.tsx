"use client";

/**
 * Replies the platform refused to guess at.
 *
 * Each row shows why it was held and the subcontractor's own words. The
 * operator reads the message and applies one answer to one solicitation and,
 * when needed, one trade.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export interface ReplyReviewRow {
  id: string;
  subcontractor_id: string;
  company_name: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  trade: string | null;
  intent: string;
  reason: string | null;
  review_reason: string | null;
  original_message: string | null;
  confidence: string;
  created_at: string;
}

interface Choice {
  outcome: string;
  label: string;
  hint: string;
}

interface TradePrompt {
  candidateTrades: Array<string | null>;
  selectedIndex: number;
}

interface ReviewResponse {
  code?: string;
  error?: string;
  message?: string;
  candidateTrades?: unknown;
}

/** The answers an operator can give, in the order they occur in real life. */
const CHOICES: Choice[] = [
  {
    outcome: "quoted",
    label: "They gave a price",
    hint: "Records an extracted price only when the amount and trade are usable.",
  },
  { outcome: "interested", label: "They're interested", hint: "Keeps this open for a price." },
  {
    outcome: "unavailable",
    label: "Busy this time",
    hint: "Closes this request without changing their fit for future work.",
  },
  {
    outcome: "not_a_fit",
    label: "Wrong scope for them",
    hint: "Marks this scope only, not the subcontractor's future work.",
  },
  { outcome: "declined", label: "They said no", hint: "Closes their request on this solicitation." },
  { outcome: "needs_info", label: "They asked a question", hint: "Keeps this open for an answer." },
  {
    outcome: "partial_scope",
    label: "Only part is priced",
    hint: "Keeps the uncovered part visible and in need of sourcing.",
  },
  { outcome: "needs_time", label: "They need more time", hint: "Keeps this reply in progress." },
  { outcome: "wrong_contact", label: "Wrong person", hint: "Keeps the company open for a corrected contact." },
  {
    outcome: "referred",
    label: "They referred us",
    hint: "Records the referral without claiming a quote.",
  },
  {
    outcome: "does_not_perform_trade",
    label: "They do not do this trade",
    hint: "Closes only this trade assignment.",
  },
  { outcome: "none", label: "Nothing to do", hint: "Dismisses the review without changing solicitation status." },
];

function tradeOptions(value: unknown): Array<string | null> {
  if (!Array.isArray(value)) return [];
  const valid = value.filter(
    (trade): trade is string | null => trade === null || typeof trade === "string"
  );
  return valid.filter((trade, index) => valid.indexOf(trade) === index);
}

export function ReplyReviewList({ rows }: { rows: ReplyReviewRow[] }) {
  const router = useRouter();
  const inFlight = useRef(new Set<string>());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [tradePrompts, setTradePrompts] = useState<Record<string, TradePrompt>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successes, setSuccesses] = useState<Record<string, string>>({});

  async function resolve(row: ReplyReviewRow) {
    const outcome = selections[row.id];
    if (!outcome) {
      setErrors((current) => ({ ...current, [row.id]: "Choose what the reply means first." }));
      return;
    }
    if (inFlight.current.has(row.id) || successes[row.id]) return;

    inFlight.current.add(row.id);
    setBusy((current) => ({ ...current, [row.id]: true }));
    setErrors((current) => ({ ...current, [row.id]: "" }));
    try {
      const prompt = tradePrompts[row.id];
      const requestBody: { outcome: string; trade?: string | null } = { outcome };
      if (prompt) requestBody.trade = prompt.candidateTrades[prompt.selectedIndex] ?? null;

      const res = await fetch(`/api/replies/${row.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = (await res.json().catch(() => ({}))) as ReviewResponse;
      if (!res.ok) {
        const candidates = tradeOptions(data.candidateTrades);
        if (
          (data.code === "trade_required" || data.code === "ambiguous_trade") &&
          candidates.length > 0
        ) {
          setTradePrompts((current) => ({
            ...current,
            [row.id]: { candidateTrades: candidates, selectedIndex: 0 },
          }));
          setErrors((current) => ({
            ...current,
            [row.id]: data.error ?? "Choose the trade, then save this review again.",
          }));
          return;
        }
        setErrors((current) => ({
          ...current,
          [row.id]: data.error ?? "The review was not saved. Try again.",
        }));
        return;
      }

      setSuccesses((current) => ({
        ...current,
        [row.id]: data.message ?? "Review saved. No email was sent.",
      }));
      router.refresh();
    } catch {
      setErrors((current) => ({
        ...current,
        [row.id]: "Could not reach the server. Check your connection and try again.",
      }));
    } finally {
      inFlight.current.delete(row.id);
      setBusy((current) => ({ ...current, [row.id]: false }));
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground/60">
        These replies still need your decision. Read the subcontractor&apos;s words, choose what
        they meant, and save one outcome for this job. Saving a review does not send email.
      </p>

      {rows.map((row) => {
        const expanded = expandedId === row.id;
        const selectedChoice = CHOICES.find((choice) => choice.outcome === selections[row.id]);
        const tradePrompt = tradePrompts[row.id];
        const isBusy = busy[row.id] === true;
        const success = successes[row.id];
        const error = errors[row.id];
        const outcomeId = `reply-outcome-${row.id}`;
        const hintId = `reply-outcome-hint-${row.id}`;
        const tradeId = `reply-trade-${row.id}`;

        return (
          <article key={row.id} className="panel-inset p-3 sm:p-4" aria-busy={isBusy}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-foreground">
                  {row.company_name ?? "A subcontractor"}
                  {row.trade ? (
                    <span className="text-foreground/55"> · {row.trade}</span>
                  ) : null}
                </p>
                {row.opportunity_id ? (
                  <Link
                    href={`/opportunity/${row.opportunity_id}`}
                    className="inline-flex coarse:min-h-11 items-center break-words py-1 text-xs text-accent hover:underline"
                  >
                    {row.opportunity_title ?? "Open the solicitation"}
                  </Link>
                ) : (
                  <span className="block py-1 text-xs text-foreground/55">
                    No solicitation linked
                  </span>
                )}
                <Link
                  href={`/subs/${row.subcontractor_id}#conversations`}
                  className="flex coarse:min-h-11 items-center py-1 text-xs text-accent hover:underline"
                >
                  Read the thread and reply
                </Link>
              </div>
              <span className="badge shrink-0 bg-review/15 text-review">Needs your read</span>
            </div>

            {row.review_reason && (
              <p className="mt-2 text-sm text-review">{row.review_reason}</p>
            )}

            {row.original_message && (
              <>
                <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-foreground/75">
                  {expanded
                    ? row.original_message
                    : `${row.original_message.slice(0, 240)}${row.original_message.length > 240 ? "…" : ""}`}
                </blockquote>
                {row.original_message.length > 240 && (
                  <button
                    type="button"
                    className="mt-1 inline-flex coarse:min-h-11 items-center text-xs text-accent hover:underline"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                  >
                    {expanded ? "Show less" : "Read the whole message"}
                  </button>
                )}
              </>
            )}

            {success ? (
              <p
                className="mt-3 rounded-md border border-pursue/30 bg-pursue/10 px-3 py-2 text-sm text-pursue"
                role="status"
                aria-live="polite"
              >
                {success}
              </p>
            ) : (
              <form
                className="mt-3 border-t border-border pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void resolve(row);
                }}
              >
                <fieldset disabled={isBusy}>
                  <legend className="text-sm font-medium text-foreground">Resolve this reply</legend>
                  <label htmlFor={outcomeId} className="mt-2 block text-xs font-medium text-foreground/75">
                    What did they mean?
                  </label>
                  <select
                    id={outcomeId}
                    className="input mt-1 min-h-11 w-full text-sm"
                    value={selections[row.id] ?? ""}
                    aria-describedby={hintId}
                    onChange={(event) => {
                      const outcome = event.target.value;
                      setSelections((current) => ({ ...current, [row.id]: outcome }));
                      setErrors((current) => ({ ...current, [row.id]: "" }));
                    }}
                  >
                    <option value="">Choose an outcome</option>
                    {CHOICES.map((choice) => (
                      <option key={choice.outcome} value={choice.outcome}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <p id={hintId} className="mt-1 text-xs text-foreground/55">
                    {selectedChoice?.hint ?? "Nothing changes until you save the review."}
                  </p>

                  {tradePrompt && (
                    <div className="mt-3 rounded-md border border-review/35 bg-review/10 p-3">
                      <label htmlFor={tradeId} className="block text-xs font-medium text-foreground">
                        Which trade does this reply apply to?
                      </label>
                      <select
                        id={tradeId}
                        className="input mt-1 min-h-11 w-full text-sm"
                        value={tradePrompt.selectedIndex}
                        onChange={(event) => {
                          const selectedIndex = Number(event.target.value);
                          setTradePrompts((current) => ({
                            ...current,
                            [row.id]: { ...tradePrompt, selectedIndex },
                          }));
                          setErrors((current) => ({ ...current, [row.id]: "" }));
                        }}
                      >
                        {tradePrompt.candidateTrades.map((trade, index) => (
                          <option key={`${trade ?? "unlabelled"}-${index}`} value={index}>
                            {trade?.trim() || "Unlabelled trade"}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-foreground/60">
                        Only the selected active trade pairing will be updated.
                      </p>
                    </div>
                  )}

                  {error && (
                    <p className="mt-3 text-sm text-risk" role="alert">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="btn-primary mt-3 min-h-11 w-full text-sm sm:w-auto"
                    disabled={!selections[row.id] || isBusy}
                  >
                    {isBusy
                      ? "Saving..."
                      : tradePrompt
                        ? "Save for this trade"
                        : "Save review"}
                  </button>
                </fieldset>
              </form>
            )}
          </article>
        );
      })}
    </div>
  );
}
