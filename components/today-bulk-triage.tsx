"use client";

import Link from "next/link";
import type { ActionOppRow } from "@/lib/data";
import type { AutomationRules } from "@/lib/domain/intake";
import { ActionButton } from "@/components/action-button";
import { PassButton } from "@/components/pass-button";
import { SnoozeButton } from "@/components/snooze-button";
import { DeadlineBadge } from "@/components/deadline-badge";
import { StopClickPropagation } from "@/components/stop-click-propagation";
import { withGuideQuery } from "@/lib/guide-links";
import { currency } from "@/lib/format";
import {
  BulkActionBar,
  BulkSelectAllCheckbox,
  BulkSelectCheckbox,
  BulkSelectionProvider,
} from "@/components/bulk-selection";

const ROW =
  "group flex flex-col gap-3 border-b border-border/55 px-1 py-4 transition-colors hover:bg-muted/40 dark:border-white/10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1.5";

export function TodayBulkTriage({
  rows,
  rules,
  focusedFirst = false,
}: {
  rows: ActionOppRow[];
  rules?: AutomationRules;
  focusedFirst?: boolean;
}) {
  const ids = rows.map((o) => o.id);

  return (
    <BulkSelectionProvider ids={ids}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <BulkSelectAllCheckbox label="Select all decisions" />
        <p className="text-xs text-muted-foreground">Pursue, pass, or snooze selected</p>
      </div>
      {rows.map((o, i) => {
        const meta = [
          o.value_estimated != null ? currency(o.value_estimated) : null,
          o.agency,
        ]
          .filter(Boolean)
          .join(" · ");
        const n = String(i + 1).padStart(2, "0");
        return (
          <Link
            key={o.id}
            href={withGuideQuery(`/opportunity/${o.id}`, {
              step: "today-triage",
              focus: "next-step",
            })}
            className={`${ROW} ${focusedFirst && i === 0 ? "focus-rail pl-3" : ""}`}
          >
            <StopClickPropagation className="pt-0.5">
              <BulkSelectCheckbox
                id={o.id}
                label={`Select ${o.title ?? "opportunity"}`}
              />
            </StopClickPropagation>
            <span className="font-mono text-[9px] tracking-[0.08em] text-muted-foreground sm:w-8">
              {n}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-gold-text">
                Pursuit decision
              </p>
              <p className="mt-1 text-sm font-medium text-foreground sm:truncate">
                {o.title ?? "Untitled opportunity"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground sm:truncate">{meta}</p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end sm:gap-3">
              <DeadlineBadge deadline={o.deadline} rules={rules} />
              <StopClickPropagation className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <SnoozeButton
                  kind="opportunity"
                  id={o.id}
                  className="shell-ghost min-h-11 text-xs lg:min-h-0"
                />
                <ActionButton
                  endpoint={`/api/opportunities/${o.id}/action`}
                  body={{ action: "pursue" }}
                  className="btn-success min-h-11 flex-1 text-xs sm:min-h-0 sm:flex-none"
                  toast={{
                    message: "Pursued. Analysis and pricing are running.",
                  }}
                >
                  Pursue opportunity
                </ActionButton>
                <PassButton opportunityId={o.id} title={o.title}>
                  Pass on this opportunity
                </PassButton>
                <span className="text-xs font-medium text-gold-text sm:ml-1">Open brief</span>
              </StopClickPropagation>
            </div>
          </Link>
        );
      })}
      <BulkActionBar
        noun="opportunity"
        actions={[
          { kind: "pursue", label: "Pursue" },
          {
            kind: "dismiss",
            label: "Pass",
            confirm: "Pass on the selected opportunities? They will be archived.",
          },
          { kind: "snooze_opps" },
        ]}
      />
    </BulkSelectionProvider>
  );
}
