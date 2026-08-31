import type { ReactNode } from "react";
import Link from "next/link";

/**
 * The left-hand pane: what there is to work through, and where you are in it.
 *
 * The position number is the part that did not exist anywhere before. Every
 * queue in this product could say how many things were in it and none of them
 * could say which one you were on, so an operator working a list of forty had
 * no way to tell a productive half hour from a slow one without counting. A
 * numbered rail turns "how much is left" from a question into a glance, and it
 * is what makes the keyboard rhythm legible: the number under the cursor moves
 * when J does.
 *
 * Rows are links, and the open row is a query parameter, so the back button
 * works and any position in the queue is a URL somebody can send.
 */

/** How a row reads at a glance. Tone maps to the product's status colours. */
export type QueueTone = "attention" | "blocked" | "waiting" | "done" | "neutral";

const TONE_CLASS: Record<QueueTone, string> = {
  attention: "bg-review/15 text-review",
  blocked: "bg-risk/15 text-risk",
  waiting: "bg-muted text-muted-foreground",
  done: "bg-pursue/15 text-pursue",
  neutral: "bg-muted text-muted-foreground",
};

export interface QueueEntry {
  /** Stable identity, used for the React key only. */
  id: string;
  href: string;
  title: string;
  /** The record it belongs to, e.g. the solicitation title. */
  context?: string | null;
  /** A short right-hand note: a countdown, a date, an amount. */
  meta?: string | null;
  /** One state word, when the row has a state worth naming. */
  state?: { label: string; tone: QueueTone } | null;
  /**
   * Finished during this sitting.
   *
   * Kept in the list rather than removed, because a queue that shortens as you
   * work gives no sense of progress: forty becoming thirty-nine looks the same
   * as forty. A ticked row does.
   */
  done?: boolean;
}

export function QueueRail({
  entries,
  selectedId,
  heading,
  summary,
  empty,
  toolbar,
  /** Rendered above the rows, under the toolbar. Filters, chips, a guide. */
  children,
}: {
  entries: QueueEntry[];
  selectedId: string | null;
  heading?: string;
  /** One line under the heading: what is in the list and in what order. */
  summary?: string;
  empty?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
}) {
  const position = entries.findIndex((e) => e.id === selectedId);

  return (
    <div className="flex min-h-0 flex-col">
      {(heading || summary || position >= 0) && (
        <div className="shrink-0 border-b border-border/40 px-4 py-3 dark:border-white/5">
          <div className="flex items-baseline justify-between gap-2">
            {heading && (
              <h2 className="truncate text-sm font-semibold text-foreground">{heading}</h2>
            )}
            {/*
              * "3 of 40", not a bare total.
              *
              * The total alone answers how much there is; this answers how far
              * in you are, which is the question somebody working a long queue
              * asks every few minutes and could previously only answer by
              * counting rows above the highlighted one.
              */}
            {position >= 0 && (
              <span className="num shrink-0 text-xs text-muted-foreground">
                {position + 1} of {entries.length}
              </span>
            )}
          </div>
          {summary && <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>}
        </div>
      )}

      {toolbar && (
        <div className="shrink-0 border-b border-border/40 px-4 py-2 dark:border-white/5">
          {toolbar}
        </div>
      )}

      {children && <div className="shrink-0 px-4 pt-3">{children}</div>}

      {entries.length === 0 ? (
        <div className="p-4">{empty}</div>
      ) : (
        <ol className="min-h-0">
          {entries.map((e, i) => {
            const active = e.id === selectedId;
            return (
              <li key={e.id}>
                <Link
                  href={e.href}
                  aria-current={active ? "true" : undefined}
                  className={`flex gap-3 border-b border-border/40 px-4 py-3 transition-colors hover:bg-foreground/[0.03] dark:border-white/5 ${
                    active ? "bg-gold/10" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`num w-6 shrink-0 pt-0.5 text-xs ${
                      e.done
                        ? "text-pursue"
                        : active
                          ? "text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    {e.done ? "✓" : String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-sm ${
                          active ? "font-semibold text-foreground" : "text-foreground"
                        } ${e.done ? "line-through decoration-1" : ""}`}
                      >
                        {e.title}
                      </span>
                      {e.meta && (
                        /*
                         * Capped at a third of the row and truncated. A meta
                         * value is meant to be a countdown or a date, and one
                         * that arrived as a sentence squeezed the title down
                         * to its first letter: the row still had a number on
                         * it and no longer said what the number was about.
                         */
                        <span className="num max-w-[33%] shrink-0 truncate text-[11px] text-muted-foreground">
                          {e.meta}
                        </span>
                      )}
                    </span>
                    {e.context && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {e.context}
                      </span>
                    )}
                    {e.state && (
                      <span className={`badge mt-1.5 ${TONE_CLASS[e.state.tone]}`}>
                        {e.state.label}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
