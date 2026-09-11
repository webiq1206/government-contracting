import Link from "next/link";
import type { OpportunitySummary } from "@/lib/types";
import type { AutomationRules } from "@/lib/domain/intake";
import type { TradeCoverage } from "@/lib/data";
import type { Owner } from "@/lib/domain/ownership";
import { DeadlineBadge } from "@/components/deadline-badge";
import { RowActions } from "@/components/row-actions";
import { opportunityRowActions } from "@/lib/domain/row-actions";
import { ScoreBadge } from "@/components/badges";
import { AgencyPath } from "@/components/agency-path";

/**
 * The default opportunity list intentionally shows only the facts needed to
 * choose a record. Confidence, trade coverage, ownership detail, blockers and
 * other evidence remain available in Quick look and the full record.
 */
export function OpportunityList({
  rows,
  rules,
  coverage: _coverage,
  owners,
  viewerId,
  nextAction,
  role,
  members = [],
  peekHrefFor,
}: {
  rows: OpportunitySummary[];
  rules?: AutomationRules;
  coverage: Map<string, TradeCoverage>;
  owners: Map<string, Owner>;
  viewerId?: string;
  nextAction?: Record<string, string>;
  role?: string | null;
  members?: Owner[];
  peekHrefFor?: (o: OpportunitySummary) => string;
}) {
  void _coverage;

  if (rows.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        Nothing here right now.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/50 overflow-hidden rounded-xl bg-surface">
      {rows.map((o) => {
        const action = nextAction?.[o.stage] ?? o.stage.replace(/_/g, " ");
        return (
          <li key={o.id} className={o.human_action_required ? "bg-accent/[0.035]" : ""}>
            <Link
              prefetch={false}
              href={`/opportunity/${o.id}`}
              className="block px-4 py-3.5 transition-colors hover:bg-muted/35"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-base font-medium leading-snug text-foreground">
                    {o.title ?? "Untitled opportunity"}
                  </p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    <AgencyPath agency={o.agency} subAgency={o.sub_agency} />
                  </p>
                </div>
                {o.score != null && <ScoreBadge score={o.score} />}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                <DeadlineBadge deadline={o.deadline} rules={rules} />
                <span className={o.human_action_required ? "font-medium text-accent" : "text-muted-foreground"}>
                  {o.human_action_required ? "Needs you" : action}
                </span>
              </div>
            </Link>

            <div className="flex items-center justify-end gap-2 px-4 pb-3">
              {peekHrefFor && (
                <a
                  href={peekHrefFor(o)}
                  className="tap text-sm text-muted-foreground underline-offset-2 hover:text-accent"
                >
                  Quick look
                </a>
              )}
              <RowActions
                actions={opportunityRowActions(
                  {
                    id: o.id,
                    title: o.title,
                    stage: o.stage,
                    status: o.status,
                    snoozedUntil: o.snoozed_until ?? null,
                    pursuitState: o.pursuit_state ?? null,
                  },
                  { role }
                )}
                members={members}
                owner={owners.get(o.id) ?? null}
                viewerId={viewerId}
                recordLabel={o.title ?? "this opportunity"}
                compact
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
