import Link from "next/link";
import type { Opportunity } from "@/lib/types";
import type { AutomationRules } from "@/lib/domain/intake";
import type { TradeCoverage } from "@/lib/data";
import type { Owner } from "@/lib/domain/ownership";
import { DeadlineBadge } from "@/components/deadline-badge";
import { ScoreBadge } from "@/components/badges";
import { EstimatedValue } from "@/components/estimated-value";
import { AgencyPath } from "@/components/agency-path";
import {
  BlockerChip,
  ConfidenceChip,
  CoverageChip,
  OwnerChip,
} from "@/components/opportunity-facts";

/**
 * The compact list: what a phone gets, and what the brief names as the third
 * view.
 *
 * What it replaces on a phone was a swipe rail of four columns. A rail asks
 * somebody to discover three more horizontal panes before they can see their
 * own work, and it is the pattern the responsive rules warn about: the
 * information is there and the way to it is a gesture nobody was told about.
 *
 * A row carries the nine facts the brief requires. Five of them were on no
 * mobile surface at all, and they are the five that say whether the number
 * beside them can be trusted: a 78 scored from a title, a bid whose trades
 * nobody has priced, and a record nobody has picked up all looked exactly like
 * their opposites.
 */
export function OpportunityList({
  rows,
  rules,
  coverage,
  owners,
  viewerId,
  nextAction,
}: {
  rows: Opportunity[];
  rules?: AutomationRules;
  coverage: Map<string, TradeCoverage>;
  owners: Map<string, Owner>;
  viewerId?: string;
  /** Stage to the sentence describing what happens next. */
  nextAction?: Record<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        Nothing here right now.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border">
      {rows.map((o) => (
        <li key={o.id}>
          <Link
            href={`/opportunity/${o.id}`}
            className={`block px-4 py-3 transition-colors hover:bg-surface/70 ${
              o.human_action_required ? "border-l-2 border-gold bg-gold/[0.04]" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* The exact next action, first, because it is the reason the
                    row is in front of anybody. */}
                <p className="eyebrow text-gold-text">
                  {nextAction?.[o.stage] ?? o.stage.replace(/_/g, " ")}
                </p>
                <p className="mt-1 line-clamp-2 text-sm font-medium text-foreground">
                  {o.title ?? "Untitled opportunity"}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  <AgencyPath agency={o.agency} subAgency={o.sub_agency} />
                </p>
              </div>
              <ScoreBadge score={o.score} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <EstimatedValue value={o.value_estimated} source={o.value_estimated_source} />
              <DeadlineBadge deadline={o.deadline} rules={rules} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <ConfidenceChip breakdown={o.score_breakdown} />
              <CoverageChip coverage={coverage.get(o.id)} />
              <OwnerChip owner={owners.get(o.id) ?? null} viewerId={viewerId} />
              <BlockerChip flags={o.risk_flags} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
