import type { ScoreBreakdown } from "@/lib/types";
import type { DataConfidence } from "@/lib/domain/score-confidence";
import { InfoTip } from "@/components/info-tip";

const CONFIDENCE_TONE: Record<DataConfidence["level"], string> = {
  high: "bg-pursue/15 text-pursue",
  medium: "bg-review/15 text-review",
  low: "bg-risk/15 text-risk",
};

const CONFIDENCE_LABEL: Record<DataConfidence["level"], string> = {
  high: "Read in full",
  medium: "Partly known",
  low: "Mostly unknown",
};

function ConfidenceLine({ confidence }: { confidence?: DataConfidence }) {
  // Scored before confidence was measured. Saying nothing is right: an absent
  // measurement is not the same as a complete reading, and inventing "high"
  // here would recreate the exact false certainty this exists to remove.
  if (!confidence) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className={`badge shrink-0 ${CONFIDENCE_TONE[confidence.level]}`}>
        {CONFIDENCE_LABEL[confidence.level]} · {confidence.percent}%
      </span>
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">{confidence.summary}</p>
    </div>
  );
}

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

      {/*
        How much of this rests on facts we have.

        The score answers "how well does this fit us". It was being read as if
        it also answered "and we know what this job is", which it never did:
        most federal notices publish no value, and some arrive as a title and
        a link. A 78 on a solicitation read in full is a reason to bid; a 78
        on a headline is a reason to go and read the notice. Same number,
        opposite instruction.
      */}
      <ConfidenceLine confidence={breakdown.data_confidence} />

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
