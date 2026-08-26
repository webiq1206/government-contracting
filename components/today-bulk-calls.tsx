"use client";

import Link from "next/link";
import type { ActionCallRow } from "@/lib/data";
import type { AutomationRules } from "@/lib/domain/intake";
import { ActionButton } from "@/components/action-button";
import { SnoozeButton } from "@/components/snooze-button";
import { DeadlineBadge } from "@/components/deadline-badge";
import { StopClickPropagation } from "@/components/stop-click-propagation";
import { withGuideQuery } from "@/lib/guide-links";
import {
  BulkActionBar,
  BulkSelectAllCheckbox,
  BulkSelectCheckbox,
  BulkSelectionProvider,
} from "@/components/bulk-selection";

const ROW =
  "group flex flex-col gap-3 border-b border-border/55 px-1 py-4 transition-colors hover:bg-muted/40 dark:border-white/10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1.5";

function CtaArrow({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-gold-text">
      {label}
      <span aria-hidden className="text-gold-text">
        ↗
      </span>
    </span>
  );
}

export function TodayBulkCalls({
  calls,
  totalCount,
  rules,
  focusedFirst = false,
}: {
  calls: ActionCallRow[];
  totalCount: number;
  rules?: AutomationRules;
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
        <Link
          key={c.id}
          href={withGuideQuery(`/call-queue?open=${c.id}`, {
            step: "today-calls",
            focus: "call-queue",
          })}
          className={`${ROW} ${focusedFirst && i === 0 ? "focus-rail pl-3" : ""}`}
        >
          <StopClickPropagation className="pt-0.5">
            <BulkSelectCheckbox id={c.id} label={`Select call ${c.company_name}`} />
          </StopClickPropagation>
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
            <StopClickPropagation className="flex items-center gap-2">
              <SnoozeButton
                kind="call_card"
                id={c.id}
                className="shell-ghost min-h-11 text-xs md:min-h-0"
              />
              <ActionButton
                endpoint={`/api/call-cards/${c.id}/skip`}
                /*
                 * min-h-11 on touch, like the control beside it. It was 40px
                 * tall and had been since it was written; the sweep only saw
                 * it once there were call cards in the account for this
                 * section to render at all.
                 */
                className="shell-ghost min-h-11 text-xs md:min-h-0"
                toast={{
                  message: `Skipped calling ${c.company_name}. Recorded on their history.`,
                  undo: {
                    endpoint: `/api/call-cards/${c.id}/skip`,
                    body: { undo: true },
                  },
                }}
              >
                Skip
              </ActionButton>
            </StopClickPropagation>
            <CtaArrow label="Start call" />
          </div>
        </Link>
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
