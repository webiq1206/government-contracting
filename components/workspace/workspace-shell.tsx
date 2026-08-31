import type { ReactNode } from "react";

/**
 * The three-pane workspace, as one component the whole product shares.
 *
 * Three surfaces had already converged on this shape independently -- Review,
 * Communications and the Call Queue each grew a queue on the left and a record
 * beside it -- and each of them wrote the responsive rules again, slightly
 * differently. This is that shape written once, so a fourth surface is a page
 * that passes three nodes rather than a fourth set of breakpoints.
 *
 * The panes, left to right:
 *
 *   queue    what there is to work through, and where you are in it
 *   primary  the one record you are on, and everything you can change on it
 *   context  what supports the decision: related records, history, evidence
 *
 * The queue is on the LEFT rather than the right. The pattern this is adapted
 * from puts it on the right, and that is the correct call in an application
 * whose reading starts at a document. Here the reading starts at the queue:
 * the sidebar is already on the left, the three existing surfaces already put
 * the queue there, and moving it would mean an operator's eye lands somewhere
 * different depending on which of four near-identical screens they opened.
 *
 * Below `xl` the context pane moves under the record rather than disappearing,
 * because the things in it -- why this is blocked, who is waiting, what the
 * last message said -- are frequently the reason the decision goes one way.
 * Hiding them on a laptop would make the laptop a worse place to decide, not a
 * smaller one. It is the same nodes in both places: the pane is written once
 * and the column direction changes, rather than a second copy that can drift.
 *
 * Below `lg` there is one pane at a time, chosen by `selected`: the queue
 * until something is open, then the record with its context beneath it. That
 * is a CSS class rather than a second implementation, which is only possible
 * because which item is open is a query parameter rather than client state.
 */
export function WorkspaceShell({
  queue,
  queueLabel = "Queue",
  primary,
  primaryLabel = "Workspace",
  context,
  contextLabel = "Supporting detail",
  selected,
  queueWidth = "lg:w-[380px]",
}: {
  queue: ReactNode;
  queueLabel?: string;
  primary: ReactNode;
  primaryLabel?: string;
  /** Omit for a two-pane surface. Nothing else changes. */
  context?: ReactNode;
  contextLabel?: string;
  /** Whether a record is open. Drives the one-pane-at-a-time rule on a phone. */
  selected: boolean;
  /** Override only when the rows genuinely need more room. */
  queueWidth?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <section
        aria-label={queueLabel}
        className={`scroll-thin w-full shrink-0 overflow-y-auto border-r border-border/55 dark:border-white/10 ${queueWidth} ${
          selected ? "hidden lg:block" : "block"
        }`}
      >
        {queue}
      </section>

      <div
        className={`scroll-thin min-w-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden ${
          selected ? "flex" : "hidden lg:flex"
        }`}
      >
        <section
          aria-label={primaryLabel}
          className="flex min-w-0 flex-col xl:min-h-0 xl:flex-1"
        >
          {primary}
        </section>

        {context && (
          <aside
            aria-label={contextLabel}
            className="scroll-thin shrink-0 border-t border-border/55 px-4 py-4 dark:border-white/10 xl:w-[320px] xl:overflow-y-auto xl:border-l xl:border-t-0"
          >
            {context}
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * The primary pane's own frame: a header that stays, a body that scrolls, and
 * a foot that does not move.
 *
 * The foot is the whole point. A decision button that scrolls away with the
 * text above it is a decision somebody defers, and every panel in this product
 * that got this right did so by writing the same three divs again.
 */
export function WorkspacePane({
  header,
  children,
  footer,
}: {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col xl:min-h-0 xl:flex-1">
      {header && (
        /*
         * Sticky rather than fixed below `xl`, where the column scrolls as one
         * and the header would otherwise leave the screen: on a long bid
         * package that means scrolling back to the top to remember which one
         * you are reading.
         */
        <header className="sticky top-0 z-10 shrink-0 border-b border-border/55 bg-background px-4 py-3 dark:border-white/10 xl:static">
          {header}
        </header>
      )}
      <div className="scroll-thin px-4 py-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {children}
      </div>
      {footer && (
        /*
         * `bottom-0`, never `bottom-16`. The shell already reserves the mobile
         * tab bar's height once, and a second clearance here parks the actions
         * in the middle of the screen rather than at its foot.
         */
        /*
          * Capped. A foot that grows with the number of choices is fine beside
          * a queue on a desktop and is a screen on a phone: six outcome
          * buttons plus their explanations once took two thirds of it. The
          * explanations moved into the body; this makes sure the next pane to
          * grow a control cannot do the same thing again.
          */
        <div className="scroll-thin sticky bottom-0 z-10 max-h-[45vh] shrink-0 overflow-y-auto border-t border-border/55 bg-background px-4 py-3 dark:border-white/10 xl:max-h-none xl:overflow-visible xl:static">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * The empty primary pane, on a wide screen with nothing chosen.
 *
 * A blank half-screen reads as a page that has not finished loading, so this
 * says what the space is for and what to do to fill it.
 */
export function WorkspacePlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** One titled block inside the context pane. */
export function ContextSection({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="border-b border-border/40 pb-4 last:border-b-0 last:pb-0 dark:border-white/5">
      <h3 className="label mb-2">{title}</h3>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}
