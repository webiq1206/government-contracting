import type { ScoreBreakdown } from "@/lib/types";
import { InfoTip } from "@/components/info-tip";

/**
 * Score dimensions with a tip on each row explaining why points were awarded
 * or withheld (uses the scoring engine's `reasoning` field).
 */
export function ScoreBreakdownCard({ breakdown }: { breakdown: ScoreBreakdown }) {
  const positives = breakdown.dimensions.filter((d) => d.points > 0);
  const risks = breakdown.dimensions.filter((d) => d.points <= 0);

  return (
    <div
      id="score"
      className="scroll-mt-editorial"
      data-guide-target="score"
    >
      <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
        Score breakdown
      </h2>
      <div className="mt-5 space-y-4">
        {positives.map((d) => {
          const pct = (d.points / Math.max(d.max_points, 1)) * 100;
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
                <span className="num shrink-0 text-gold">+{d.points}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-border">
                <div
                  className="h-1 rounded-full bg-gold"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {risks.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-risk">
            Risk flags
          </p>
          <ul className="mt-2 space-y-2">
            {risks.map((d) => (
              <li key={d.key} className="flex items-start justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                  <span className="truncate">{d.label}</span>
                  {d.reasoning ? (
                    <InfoTip label={`Why: ${d.label}`} side="bottom">
                      {d.reasoning}
                    </InfoTip>
                  ) : null}
                </span>
                <span className="num shrink-0 text-risk">{d.points}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {breakdown.summary && (
        <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-slate-500">
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
    </div>
  );
}
