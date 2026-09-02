import Link from "next/link";
import type { WorkItem } from "@/lib/domain/work-queue";
import { summarizeQueue } from "@/lib/domain/work-queue";
import { DeadlineBadge } from "@/components/deadline-badge";
import { describeOwner, type Owner } from "@/lib/domain/ownership";
import { RowActions } from "@/components/row-actions";
import { workItemRowActions } from "@/lib/domain/row-actions";

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
export function WorkQueue({
  items,
  limit,
  viewerId,
  role,
  members = [],
  peekHrefFor,
}: {
  items: WorkItem[];
  limit?: number;
  /** So a row assigned to the reader says "You" rather than their own name. */
  viewerId?: string;
  /**
   * The reader's role, which decides what the row offers. Absent means the
   * caller did not ask, and a row with no role offers nothing rather than
   * guessing: the alternative is a button that fails on click.
   */
  role?: string | null;
  /** Everybody the record could be handed to. Without it, reassign is dropped. */
  members?: Owner[];
  /** Today supplies the shareable drawer URL; other renderers keep plain rows. */
  peekHrefFor?: (item: WorkItem) => string;
}) {
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
            <li key={item.key} className="sm:flex sm:items-center">
              <Link
                href={item.href}
                className="flex min-h-14 flex-1 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface/70 sm:px-5"
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
                    {/*
                      Whose it is. Shown on every row including unassigned
                      ones, because "nobody has picked this up" is the state
                      worth seeing: a blank column reads as a rendering fault
                      and gets ignored, where the word is something to act on.
                    */}
                    <span className="text-xs text-muted-foreground">
                      {describeOwner(item.owner, viewerId)}
                    </span>
                  </div>
                  {/*
                    The blocker before the reason: when automation named
                    something it could not get past, that IS the reason, and
                    repeating a generic one underneath it would be noise.
                  */}
                  {item.blocker ? (
                    <p className="mt-1 line-clamp-2 text-xs text-review">
                      <span className="label mr-1 inline">Blocked</span>
                      {item.blocker}
                    </p>
                  ) : item.reason ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
                  ) : null}
                </div>
                <span
                  className={`${
                    i === 0 ? "btn-primary" : "btn-ghost"
                  } pointer-events-none shrink-0 whitespace-nowrap px-3 py-1.5 text-xs`}
                >
                  {item.actionLabel}
                </span>
              </Link>
              {/*
                The row's own controls, beside the link on a wide screen and
                under it on a phone rather than hidden there.
                Without these the one queue was the least capable place to work
                from: deciding meant opening the record, deciding, and coming
                back to a list that had moved, while the themed sections
                further down the page had had these controls all along. They
                sit outside the Link rather than inside it with a click
                swallowed, so a keyboard reaches them in the order they read.
              */}
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:shrink-0 sm:px-5 sm:pb-0">
                {peekHrefFor && (
                  <Link
                    href={peekHrefFor(item)}
                    scroll={false}
                    className="tap text-xs text-slate-500 underline-offset-2 hover:text-accent"
                  >
                    Quick look
                  </Link>
                )}
                <RowActionsForItem
                  item={item}
                  role={role}
                  members={members}
                  viewerId={viewerId}
                />
              </div>
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

/**
 * One row's controls, worked out from the row itself.
 *
 * Split out so the queue's markup stays readable and so the mapping from a
 * work item to its actions has one name. What is offered is decided in
 * `lib/domain/row-actions`, which every other surface uses too: a rule fixed
 * there is fixed here without this file changing.
 */
function RowActionsForItem({
  item,
  role,
  members,
  viewerId,
}: {
  item: WorkItem;
  role?: string | null;
  members: Owner[];
  viewerId?: string;
}) {
  const actions = workItemRowActions(
    {
      record: item.record ?? null,
      opportunityId: item.opportunityId ?? null,
      href: item.href,
      actionLabel: item.actionLabel,
      decide: Boolean(item.actions?.decide),
      snooze: item.actions?.snooze ?? null,
      call: item.actions?.call ?? null,
      title: item.actions?.decide?.title ?? item.context ?? item.title,
    },
    { role }
  );
  if (actions.length === 0) return null;
  return (
    <RowActions
      actions={actions}
      members={members}
      owner={item.owner ?? null}
      viewerId={viewerId}
      recordLabel={item.title}
    />
  );
}
