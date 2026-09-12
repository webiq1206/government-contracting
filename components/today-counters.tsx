import { PendingLink as Link } from "@/components/pending-link";
import type { QueueCounts, QueueFilter } from "@/lib/domain/work-queue";
import { QUEUE_FILTER_LABEL } from "@/lib/domain/work-queue";
import type { CompletedItem, CompletedToday } from "@/lib/data";

/** Compact queue summary. Details belong in the work list, not in dashboard chrome. */
export function TodayCounters({
  counts,
  done,
  active,
  hrefFor,
  completedHref,
}: {
  counts: QueueCounts;
  done: CompletedToday;
  active: QueueFilter;
  hrefFor: (f: QueueFilter) => string;
  completedHref: string;
}) {
  const cells: { key: QueueFilter; value: number; tone: string }[] = [
    { key: "overdue", value: counts.overdue, tone: counts.overdue > 0 ? "text-risk" : "text-foreground" },
    { key: "due_today", value: counts.dueToday, tone: counts.dueToday > 0 ? "text-review" : "text-foreground" },
    { key: "remaining", value: counts.remaining, tone: "text-foreground" },
  ];

  const itemClass = (selected: boolean) =>
    `inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm transition-colors ${
      selected ? "bg-accent-soft font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {cells.map((cell) => (
        <Link
          key={cell.key}
          href={hrefFor(active === cell.key ? "all" : cell.key)}
          aria-current={active === cell.key ? "page" : undefined}
          className={itemClass(active === cell.key)}
        >
          <span>{cell.key === "remaining" ? "Later" : QUEUE_FILTER_LABEL[cell.key]}</span>
          <span className={`num font-semibold ${cell.tone}`}>{cell.value}</span>
        </Link>
      ))}
      <Link
        href={completedHref}
        aria-current={active === "completed_today" ? "page" : undefined}
        className={itemClass(active === "completed_today")}
      >
        <span>Done</span>
        <span className="num font-semibold text-pursue">{done.total}</span>
      </Link>
    </div>
  );
}

export function CompletedList({ items, timezone }: { items: CompletedItem[] | null; timezone: string }) {
  if (items == null) {
    return (
      <section className="rounded-xl bg-surface p-6 text-center">
        <p className="text-sm text-foreground">Could not load what was finished today.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The work still happened. Reload to try this list again.
        </p>
      </section>
    );
  }
  if (items.length === 0) {
    return (
      <section className="rounded-xl bg-surface p-6 text-center">
        <p className="text-sm text-foreground">Nothing finished yet today.</p>
      </section>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-foreground">Finished today</h2>
        <p className="text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? "item" : "items"}
        </p>
      </div>
      <ul className="divide-y divide-border/50">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/35 sm:px-5"
            >
              <span className="text-sm text-foreground">{item.title}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{item.context}</span>
              <time className="num ml-auto shrink-0 text-xs text-muted-foreground" dateTime={item.at}>
                {new Date(item.at).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: timezone,
                })}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CompletedTodayPanel({ done, timezone }: { done: CompletedToday; timezone: string }) {
  const parts = [
    done.found > 0 && `${done.found} bid${done.found === 1 ? "" : "s"} found`,
    done.emailsSent > 0 && `${done.emailsSent} email${done.emailsSent === 1 ? "" : "s"} sent`,
    done.calls > 0 && `${done.calls} call${done.calls === 1 ? "" : "s"} placed`,
    done.quotes > 0 && `${done.quotes} quote${done.quotes === 1 ? "" : "s"} entered`,
    done.bidsSubmitted > 0 && `${done.bidsSubmitted} bid${done.bidsSubmitted === 1 ? "" : "s"} submitted`,
    done.decisions > 0 && `${done.decisions} decision${done.decisions === 1 ? "" : "s"} recorded`,
    done.complianceResolved > 0 && `${done.complianceResolved} compliance item${done.complianceResolved === 1 ? "" : "s"} resolved`,
  ].filter(Boolean) as string[];

  return (
    <section id="completed" className="pt-3">
      <h2 className="text-sm font-semibold text-foreground">Completed today</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {parts.length === 0 ? "Nothing finished yet today." : `${parts.join(" · ")}.`}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{timezone}</p>
    </section>
  );
}
