import type { TradeCoverageSummary } from "@/lib/domain/trade-coverage";

/**
 * The one sentence nobody should have to infer: how many trades this job
 * needs priced, and how many are done.
 *
 * A multi-trade solicitation looks identical to a single-trade one until you
 * open Coverage and count sections, which is exactly the inference the
 * operator should never have to make. This sits in the always-visible banner
 * area: the count as words, then one chip per trade colored by its furthest
 * state, so "2 trades, 1 still needs pricing" is read, not deduced.
 * Single-trade jobs say so too; the absence of a warning is also information.
 */
const TONE: Record<string, string> = {
  complete: "bg-pursue/15 text-pursue",
  in_progress: "bg-accent/15 text-accent-strong",
  action_required: "bg-risk/15 text-risk",
  empty: "bg-risk/15 text-risk",
};

const GLYPH: Record<string, string> = {
  complete: "✓",
  in_progress: "…",
  action_required: "!",
  empty: "!",
};

export function TradeRequirementSummary({
  coverage,
}: {
  coverage: TradeCoverageSummary;
}) {
  const trades = coverage.trades;
  if (trades.length === 0) return null;
  const done = trades.filter((t) => t.status === "complete").length;
  const n = trades.length;

  return (
    <div className="rounded-md border border-border/75 bg-surface px-3 py-2.5 dark:border-white/[0.17]">
      <p className="text-sm font-medium text-foreground">
        {n === 1
          ? "This job needs 1 trade priced"
          : `This job needs ${n} different trades priced`}
        {": "}
        <span className={done === n ? "text-pursue" : "text-review"}>
          {done} of {n} {done === n ? "done" : "have pricing"}
        </span>
        .
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {trades.map((t) => (
          <a
            key={t.trade}
            href="#coverage"
            className={`badge ${TONE[t.status]} hover:opacity-80`}
            title={t.statusLabel}
          >
            <span aria-hidden>{GLYPH[t.status]}</span> {t.trade}
          </a>
        ))}
      </div>
    </div>
  );
}
