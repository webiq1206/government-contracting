import { flagSummary } from "@/lib/flag-labels";
import { describeOwner, type Owner } from "@/lib/domain/ownership";
import type { TradeCoverage } from "@/lib/data";

/**
 * The facts the brief requires on every opportunity card and row.
 *
 * Exact next action, government deadline, fit score, data confidence, trade
 * coverage, value confidence, stage, owner and blocker. Four of those nine
 * were on the card and five were not, and the five missing ones are the ones
 * that say whether the number beside them can be trusted.
 *
 * One component so the card and the compact list cannot describe the same
 * record differently, which is the failure that made the old board and the old
 * table disagree about what "ready" meant.
 */

/**
 * How much of the score rests on facts the notice stated.
 *
 * Absent when the record was scored before this was measured, and that is not
 * "low": low is a measurement, and this is its absence. A record with no
 * reading says so rather than wearing the worst badge available.
 */
export function ConfidenceChip({ breakdown }: { breakdown: unknown }) {
  const level = readConfidence(breakdown);
  if (!level) {
    return (
      <span className="badge bg-muted text-muted-foreground" title="This record was scored before data confidence was measured.">
        Confidence not measured
      </span>
    );
  }
  const tone =
    level === "high"
      ? "bg-pursue/15 text-pursue"
      : level === "medium"
        ? "bg-review/15 text-review"
        : "bg-risk/15 text-risk";
  return <span className={`badge ${tone}`}>{LEVEL_WORD[level]}</span>;
}

const LEVEL_WORD: Record<string, string> = {
  high: "Read in full",
  medium: "Partly read",
  low: "Barely read",
};

export function readConfidence(breakdown: unknown): "high" | "medium" | "low" | null {
  if (!breakdown || typeof breakdown !== "object") return null;
  const dc = (breakdown as Record<string, unknown>).data_confidence;
  if (!dc || typeof dc !== "object") return null;
  const level = (dc as Record<string, unknown>).level;
  return level === "high" || level === "medium" || level === "low" ? level : null;
}

/**
 * How much of the work has a price.
 *
 * "0 of 0" is not full coverage, it is an analysis that has not run, and the
 * two must not render the same way: one is a bid ready to price and the other
 * is a bid nobody has read.
 */
export function CoverageChip({ coverage }: { coverage?: TradeCoverage }) {
  if (!coverage || coverage.required === 0) {
    return (
      <span className="badge bg-muted text-muted-foreground">Trades not read yet</span>
    );
  }
  const complete = coverage.covered >= coverage.required;
  return (
    <span
      className={`badge ${complete ? "bg-pursue/15 text-pursue" : "bg-review/15 text-review"}`}
    >
      {coverage.covered} of {coverage.required} trades priced
    </span>
  );
}

/** Whose it is. Never a blank, which reads as a rendering fault. */
export function OwnerChip({ owner, viewerId }: { owner?: Owner | null; viewerId?: string }) {
  return (
    <span className="badge bg-surface-raised text-muted-foreground">
      {describeOwner(owner, viewerId)}
    </span>
  );
}

/**
 * What automation could not get past, in its own words.
 *
 * Named rather than counted. "1 blocker" tells somebody to open the record to
 * find out what it is, which is the click this chip exists to save.
 */
export function BlockerChip({ flags }: { flags?: string[] | null }) {
  if (!flags || flags.length === 0) return null;
  return (
    <span className="badge bg-risk/15 text-risk" title={flagSummary(flags)}>
      {flagSummary(flags)}
    </span>
  );
}
