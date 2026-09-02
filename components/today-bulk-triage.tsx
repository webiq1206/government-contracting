"use client";

import Link from "next/link";
import type { ActionOppRow } from "@/lib/data";
import type { AutomationRules } from "@/lib/domain/intake";
import { DeadlineBadge } from "@/components/deadline-badge";
import { RowActions } from "@/components/row-actions";
import { opportunityRowActions } from "@/lib/domain/row-actions";
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
  role,
  focusedFirst = false,
}: {
  rows: ActionOppRow[];
  rules?: AutomationRules;
  /** The viewer's role, so a read-only account is not shown decisions to make. */
  role?: string | null;
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
          /*
           * The row is a container: the link covers the facts, the checkbox
           * and the controls sit beside it. They used to be nested in the
           * anchor behind a wrapper that cancelled the click, which is
           * invalid markup and fatal for any control that is itself a link.
           */
          <div
            key={o.id}
            className={`${ROW} ${focusedFirst && i === 0 ? "focus-rail pl-3" : ""}`}
          >
            <div className="pt-0.5">
              <BulkSelectCheckbox id={o.id} label={`Select ${o.title ?? "opportunity"}`} />
            </div>
            <Link
              href={withGuideQuery(`/opportunity/${o.id}`, {
                step: "today-triage",
                focus: "next-step",
              })}
              className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1.5"
            >
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
                <span className="text-xs font-medium text-gold-text sm:ml-1">Open brief</span>
              </div>
            </Link>
            {/*
              The same controls, from the same rules, as every other list. A
              read-only account is shown none of them rather than buttons its
              own endpoints would refuse.
            */}
            <RowActions
              actions={opportunityRowActions(
                { id: o.id, title: o.title, stage: o.stage },
                { role }
              )}
              recordLabel={o.title ?? "this opportunity"}
              className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0"
            />
          </div>
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
