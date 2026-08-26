import Link from "next/link";
import type { QueueCounts, QueueFilter } from "@/lib/domain/work-queue";
import { QUEUE_FILTER_LABEL } from "@/lib/domain/work-queue";
import type { CompletedToday } from "@/lib/data";

/**
 * The four numbers a person wants before they want anything else.
 *
 * "Needs you: 12" answers how much, which is the least useful of the questions
 * somebody opening this page has. How much of it is already late is what
 * decides whether this is a normal morning, and it was not on the page at all.
 *
 * Each counter is also its filter, so reading a number and acting on it is one
 * click rather than reading a number and then finding the control that matches
 * it. Completed today is the exception: it is not a filter on the queue,
 * because the queue is what is left.
 */
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

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((c) => (
        <Link
          key={c.key}
          href={hrefFor(active === c.key ? "all" : c.key)}
          aria-current={active === c.key ? "page" : undefined}
          className={`rounded-md border px-3 py-2.5 transition-colors ${
            active === c.key
              ? "border-gold bg-gold/10"
              : "border-border/55 hover:border-foreground/30 dark:border-white/10"
          }`}
        >
          <span className="block text-xs uppercase tracking-wide text-slate-500">
            {QUEUE_FILTER_LABEL[c.key]}
          </span>
          <span className={`num block text-2xl ${c.tone}`}>{c.value}</span>
        </Link>
      ))}

      {/*
        * Not a filter. The queue is what is left, so filtering it to "done"
        * would show nothing and read as a broken control. It links to the
        * section at the foot of the page instead.
        */}
      <Link
        href={completedHref}
        className="rounded-md border border-border/55 px-3 py-2.5 transition-colors hover:border-foreground/30 dark:border-white/10"
      >
        <span className="block text-xs uppercase tracking-wide text-slate-500">
          Completed today
        </span>
        <span className="num block text-2xl text-pursue">{done.total}</span>
      </Link>
    </div>
  );
}

/**
 * What got finished, at the foot of the page and quieter than the queue.
 *
 * Counted from what the work leaves behind rather than from the queue, so an
 * account with nothing to do and an account that has done everything do not
 * read the same. Named parts rather than one number, because "6" tells you
 * nothing and "3 calls, 2 quotes, a bid submitted" is a day.
 */
export function CompletedTodayPanel({ done }: { done: CompletedToday }) {
  const parts = [
    done.calls > 0 && `${done.calls} call${done.calls === 1 ? "" : "s"} placed`,
    done.quotes > 0 && `${done.quotes} quote${done.quotes === 1 ? "" : "s"} entered`,
    done.bidsSubmitted > 0 &&
      `${done.bidsSubmitted} bid${done.bidsSubmitted === 1 ? "" : "s"} submitted`,
    done.decisions > 0 && `${done.decisions} decision${done.decisions === 1 ? "" : "s"} recorded`,
    done.complianceResolved > 0 &&
      `${done.complianceResolved} compliance item${done.complianceResolved === 1 ? "" : "s"} resolved`,
  ].filter(Boolean) as string[];

  return (
    <section id="completed" className="scroll-mt-6 border-t border-border/55 pt-4 dark:border-white/10">
      <h2 className="text-xs uppercase tracking-wide text-slate-500">Completed today</h2>
      {parts.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">
          Nothing finished yet today. This fills in as calls are placed, quotes go in
          and bids go out.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-600">{parts.join(" · ")}.</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Counted from the day boundary on the server, so an operator several
        timezones away will see it roll over at a different local hour.
      </p>
    </section>
  );
}
