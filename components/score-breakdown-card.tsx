import type { ScoreBreakdown } from "@/lib/types";
import { Collapsible } from "@/components/collapsible";
import { InfoTip } from "@/components/info-tip";

/**
 * Score dimensions with a tip on each row explaining why points were awarded
 * or withheld (uses the scoring engine's `reasoning` field).
 */
export function ScoreBreakdownCard({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <div id="score" className="scroll-mt-12" data-guide-target="score">
      <Collapsible
        title="Score breakdown"
        meta={<span className="num">{breakdown.total}/100</span>}
        defaultOpen
      >
        <p className="mb-3 text-xs text-slate-500">
          Tap the ? on any row to see why those points were awarded or withheld.
        </p>
        <div className="space-y-3">
          {breakdown.dimensions.map((d) => {
            const pct = (d.points / Math.max(d.max_points, 1)) * 100;
            const tone =
              d.points <= 0
                ? "bg-slate-300"
                : pct >= 70
                  ? "bg-pursue"
                  : pct >= 40
                    ? "bg-accent"
                    : "bg-review";
            return (
              <div key={d.key} className="text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                    <span className="truncate">{d.label}</span>
                    {d.reasoning ? (
                      <InfoTip label={`Why: ${d.label}`} side="bottom">
                        {d.reasoning}
                      </InfoTip>
                    ) : null}
                  </span>
                  <span className="num shrink-0 text-slate-500">
                    {d.points}/{d.max_points}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface">
                  <div
                    className={`h-1.5 rounded-full ${tone}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {breakdown.summary && (
          <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-slate-500">
            {breakdown.summary}
          </p>
        )}
        {breakdown.hard_exclusions_triggered?.length > 0 && (
          <div className="mt-3 rounded-md border border-risk/30 bg-risk/5 px-3 py-2">
            <p className="label text-risk">Hard exclusions</p>
            <ul className="mt-1 space-y-0.5 text-xs text-risk">
              {breakdown.hard_exclusions_triggered.map((x) => (
                <li key={x}>{x.replace(/_/g, " ")}</li>
              ))}
            </ul>
          </div>
        )}
      </Collapsible>
    </div>
  );
}
