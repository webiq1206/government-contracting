import Link from "next/link";
import type { WorkItem } from "@/lib/domain/work-queue";
import { summarizeQueue } from "@/lib/domain/work-queue";
import { DeadlineBadge } from "@/components/deadline-badge";

/**
 * The one list of everything waiting on the operator, each row carrying the
 * single action that completes it.
 *
 * The task-list pattern every mature CRM converges on: a checklist with the
 * ask in plain language, the record it belongs to, the deadline, and one
 * button. Only the first row's button is rendered as primary; a list where
 * every action shouts equally is how "what should I do next" stops having an
 * answer. Server-rendered; rows are links, no client JS.
 */
export function WorkQueue({ items, limit }: { items: WorkItem[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  const more = items.length - shown.length;

  return (
    <section className="card p-0" data-guide-target="work-queue">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Your queue</h2>
        <p className="text-xs text-muted-foreground">{summarizeQueue(items)}</p>
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing needs you right now. The system keeps working; new items land here.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {shown.map((item, i) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface/70 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {item.context && (
                      <span className="truncate text-xs text-muted-foreground">
                        {item.context}
                      </span>
                    )}
                    <DeadlineBadge deadline={item.due ?? null} />
                  </div>
                </div>
                <span
                  className={`${
                    i === 0 ? "btn-primary" : "btn-ghost"
                  } pointer-events-none shrink-0 whitespace-nowrap px-3 py-1.5 text-xs`}
                >
                  {item.actionLabel}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {more > 0 && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground sm:px-5">
          {more} more in the queue.
        </p>
      )}
    </section>
  );
}
