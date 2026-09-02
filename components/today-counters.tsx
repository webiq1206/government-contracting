import Link from "next/link";
import type { QueueCounts, QueueFilter } from "@/lib/domain/work-queue";
import { QUEUE_FILTER_LABEL } from "@/lib/domain/work-queue";
import type { CompletedItem, CompletedToday } from "@/lib/data";

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
    <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
      {cells.map((c) => (
        <Link
          key={c.key}
          href={hrefFor(active === c.key ? "all" : c.key)}
          aria-current={active === c.key ? "page" : undefined}
          title={
            c.key === "remaining"
              ? "Not due today, including work with no date"
              : undefined
          }
          className={`rounded-md border px-2 py-2 transition-colors sm:px-3 sm:py-2.5 ${
            active === c.key
              ? "border-gold bg-gold/10"
              : "border-border/55 hover:border-foreground/30 dark:border-white/10"
          }`}
        >
          <span className="block text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">
            {QUEUE_FILTER_LABEL[c.key]}
          </span>
          <span className={`num block text-xl sm:text-2xl ${c.tone}`}>{c.value}</span>
        </Link>
      ))}

      {/*
        * Not a filter. The queue is what is left, so filtering it to "done"
        * would show nothing and read as a broken control. It links to the
        * section at the foot of the page instead.
        */}
      <Link
        href={completedHref}
        aria-current={active === "completed_today" ? "page" : undefined}
        className={`rounded-md border px-2 py-2 transition-colors sm:px-3 sm:py-2.5 ${
          active === "completed_today"
            ? "border-gold bg-gold/10"
            : "border-border/55 hover:border-foreground/30 dark:border-white/10"
        }`}
      >
          <span className="block text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">
          Completed today
        </span>
        <span className="num block text-xl text-pursue sm:text-2xl">{done.total}</span>
        <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
          <span className="num">{done.found}</span> found
          <span aria-hidden className="mx-0.5">
            ·
          </span>
          <span className="num">{done.emailsSent}</span> emails
        </span>
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
/**
 * What was finished today, as records rather than as a total.
 *
 * The counter answers "how much"; this answers "what", which is the question
 * somebody actually has at five o'clock. A count of six and a list of the six
 * are different objects, and only one of them can be checked against memory.
 *
 * Quieter than the queue on purpose. Completed work is context, not something
 * to act on, and the brief asks for finished work to be de-emphasised without
 * being hidden.
 */
export function CompletedList({ items }: { items: CompletedItem[] | null }) {
  if (items == null) {
    /*
     * The read failed. Not an empty list: "nothing finished today" and "we
     * could not find out" are different days, and printing the first when the
     * second happened is the failure this product is built to avoid.
     */
    return (
      <section className="card p-6 text-center">
        <p className="text-sm text-foreground">Could not load what was finished today.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The work still happened; this list is what failed to load. Reload to try again.
        </p>
      </section>
    );
  }
  if (items.length === 0) {
    return (
      <section className="card p-6 text-center">
        <p className="text-sm text-foreground">Nothing finished yet today.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Bids found, emails sent, calls, quotes, submitted bids, decisions and
          compliance items all land here.
        </p>
      </section>
    );
  }
  return (
    <section className="card p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Finished today</h2>
        <p className="text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? "item" : "items"}, newest first
        </p>
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-surface sm:px-5"
            >
              <span className="text-sm text-foreground">{item.title}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{item.context}</span>
              <time className="num ml-auto shrink-0 text-xs text-muted-foreground" dateTime={item.at}>
                {new Date(item.at).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CompletedTodayPanel({ done }: { done: CompletedToday }) {
  const parts = [
    done.found > 0 && `${done.found} bid${done.found === 1 ? "" : "s"} found`,
    done.emailsSent > 0 && `${done.emailsSent} email${done.emailsSent === 1 ? "" : "s"} sent`,
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
          Nothing finished yet today. Bids found, emails sent, calls, quotes and
          submitted bids land here.
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
