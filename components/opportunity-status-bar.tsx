import Link from "next/link";
import { DeadlineCountdown } from "@/components/deadline-countdown";
import { describeOwner, type Owner } from "@/lib/domain/ownership";
import { flagSummary } from "@/lib/flag-labels";
import { readConfidence } from "@/components/opportunity-facts";

/**
 * The nine facts that stay on screen when the hero scrolls away.
 *
 * The pinned bar carried the stage and nothing else, so an operator three
 * screens into the Requirements tab could not see when the bid was due, whose
 * it was, or that automation had stopped on something. Every one of those was
 * on the page, at the top, past the scroll.
 *
 * Compact rather than a second hero. The hero is where each of these is stated
 * in full; this is what is left of them, and the difference matters because
 * repeating the hero here would be the "same summary in several cards" the
 * brief rules out. Values only, short enough to read sideways.
 *
 * Each one refuses to overstate. A readiness nobody computed says so, an
 * unmeasured confidence is not "low", and an opportunity with no deadline says
 * the notice did not state one rather than showing a dash.
 */
export function OpportunityStatusBar({
  stageLabel,
  deadline,
  score,
  scoreBreakdown,
  owner,
  viewerId,
  readinessPercent,
  packageReady,
  uncoveredTrades,
  riskFlags,
  nextAction,
}: {
  stageLabel: string;
  deadline: string | null;
  score: number | null;
  scoreBreakdown: unknown;
  owner: Owner | null;
  viewerId?: string;
  /** 0-100 from the readiness checklist, or null when nothing computed it. */
  readinessPercent: number | null;
  packageReady: boolean | null;
  uncoveredTrades: number;
  riskFlags: string[] | null;
  /** The one thing to do next, and where it is. */
  nextAction: { label: string; href: string } | null;
}) {
  const confidence = readConfidence(scoreBreakdown);
  return (
    <div
      // Scrolls sideways rather than wrapping to three lines: this bar is
      // pinned, and a pinned element that grows eats the page it is pinned to.
      className="scroll-thin flex items-center gap-2 overflow-x-auto whitespace-nowrap text-xs"
      aria-label="Opportunity status"
    >
      <span className="badge bg-surface-raised text-slate-600">{stageLabel}</span>

      <span className="shrink-0">
        {deadline ? (
          <DeadlineCountdown deadline={deadline} />
        ) : (
          <span className="text-muted-foreground">No deadline in the notice</span>
        )}
      </span>

      <span className="shrink-0 text-muted-foreground">
        Fit{" "}
        <span className="num text-foreground">{score == null ? "not scored" : score}</span>
      </span>

      <span className="shrink-0 text-muted-foreground">
        {confidence ? `Notice ${CONFIDENCE_WORD[confidence]}` : "Readability not measured"}
      </span>

      <span className="shrink-0 text-muted-foreground">{describeOwner(owner, viewerId)}</span>

      <span className="shrink-0 text-muted-foreground">
        {/*
          Two different facts, and the package flag wins when it exists: a
          validated package is a statement about this bid, where the percentage
          is a count of checklist items.
        */}
        {packageReady === true
          ? "Package validated"
          : readinessPercent == null
            ? "Readiness not computed"
            : `${readinessPercent}% ready`}
      </span>

      {uncoveredTrades > 0 && (
        <span className="badge shrink-0 bg-review/15 text-review">
          {uncoveredTrades} trade{uncoveredTrades === 1 ? "" : "s"} unpriced
        </span>
      )}

      {riskFlags && riskFlags.length > 0 && (
        <span className="badge shrink-0 bg-risk/15 text-risk" title={flagSummary(riskFlags)}>
          {flagSummary(riskFlags)}
        </span>
      )}

      {nextAction && (
        <Link
          href={nextAction.href}
          className="btn-primary ml-auto shrink-0 whitespace-nowrap px-3 py-1 text-xs"
        >
          {nextAction.label}
        </Link>
      )}
    </div>
  );
}

const CONFIDENCE_WORD: Record<string, string> = {
  high: "read in full",
  medium: "partly read",
  low: "barely read",
};
