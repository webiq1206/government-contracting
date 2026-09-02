"use client";

import Link from "next/link";
import type { ActionCallRow } from "@/lib/data";
import type { AutomationRules } from "@/lib/domain/intake";
import { DeadlineBadge } from "@/components/deadline-badge";
import { RowActions } from "@/components/row-actions";
import { callCardRowActions } from "@/lib/domain/row-actions";
import { withGuideQuery } from "@/lib/guide-links";
import {
  BulkActionBar,
  BulkSelectAllCheckbox,
  BulkSelectCheckbox,
  BulkSelectionProvider,
} from "@/components/bulk-selection";

const ROW =
  "group flex flex-col gap-3 border-b border-border/55 px-1 py-4 transition-colors hover:bg-muted/40 dark:border-white/10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1.5";

export function TodayBulkCalls({
  calls,
  totalCount,
  rules,
  role,
  focusedFirst = false,
}: {
  calls: ActionCallRow[];
  totalCount: number;
  rules?: AutomationRules;
  /** The viewer's role, so a read-only account is not offered skips and snoozes. */
  role?: string | null;
  focusedFirst?: boolean;
}) {
  const ids = calls.map((c) => c.id);

  return (
    <BulkSelectionProvider ids={ids}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <BulkSelectAllCheckbox label="Select visible calls" />
        <p className="text-xs text-muted-foreground">Skip or snooze selected</p>
      </div>
      {calls.map((c, i) => (
        /*
         * A container row, with the link over the facts and the controls
         * beside it. Nesting them in the anchor needed a wrapper that
         * cancelled the click, and that wrapper kills any action that is
         * itself a link, which "Start the call" is.
         */
        <div
          key={c.id}
          className={`${ROW} ${focusedFirst && i === 0 ? "focus-rail pl-3" : ""}`}
        >
          <div className="pt-0.5">
            <BulkSelectCheckbox id={c.id} label={`Select call ${c.company_name}`} />
          </div>
          <Link
            href={withGuideQuery(`/call-queue?open=${c.id}`, {
              step: "today-calls",
              focus: "call-queue",
            })}
            className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="eyebrow-gold">Quote follow-up</p>
              <p className="mt-1 text-sm font-medium text-foreground sm:truncate">
                Call {c.company_name}
                {c.trade
                  ? ` about ${c.trade.toLowerCase()} pricing`
                  : " for their quote"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground sm:truncate">
                {[c.opportunity_title, c.phone ?? "no phone on file"]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {c.work_summary && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-muted-foreground">Work: </span>
                  {c.work_summary}
                </p>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:gap-3">
              {c.source === "reply" && (
                <span className="badge bg-pursue/20 text-pursue">Replied, interested</span>
              )}
              <DeadlineBadge deadline={c.deadline} rules={rules} />
            </div>
          </Link>
          {/*
            Starting the call is the button here, and skipping still asks why
            rather than shortening the queue quietly. Both come from the rules
            every other list uses, so a read-only account sees neither.
          */}
          <RowActions
            actions={callCardRowActions(
              {
                id: c.id,
                companyName: c.company_name,
                trade: c.trade,
                openHref: withGuideQuery(`/call-queue?open=${c.id}`, {
                  step: "today-calls",
                  focus: "call-queue",
                }),
              },
              { role }
            )}
            recordLabel={c.company_name}
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0"
          />
        </div>
      ))}
      {totalCount > calls.length && (
        <Link
          href="/call-queue"
          className="block border-b border-border/55 px-1 py-3 text-center text-xs text-foreground/45 transition-colors hover:text-gold-text dark:border-white/10"
        >
          {totalCount - calls.length} more call
          {totalCount - calls.length === 1 ? "" : "s"} in the queue →
        </Link>
      )}
      <BulkActionBar
        noun="call"
        actions={[
          { kind: "skip_calls", label: "Skip" },
          { kind: "snooze_calls" },
        ]}
      />
    </BulkSelectionProvider>
  );
}
