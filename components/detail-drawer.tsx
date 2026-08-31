import type { ReactNode } from "react";
import Link from "next/link";

/**
 * A record, read without leaving the list it is in.
 *
 * The tables answer "which of these" and the record pages answer "everything
 * about this one". Between them sits the question people actually ask while
 * scanning a table -- is this the one -- and answering it meant opening the
 * record, reading four fields, and coming back to a table that had forgotten
 * where you were.
 *
 * Driven by a query parameter rather than client state, for the same reasons
 * the conversation centre is: the back button works, the peek is a shareable
 * link, and the mobile behaviour is a CSS class rather than a second
 * implementation. It is a right-hand column on a wide screen and a full sheet
 * on a narrow one.
 *
 * Server component. Everything in it is already known by the time the page
 * renders, so there is nothing here for the browser to fetch.
 */
export function DetailDrawer({
  title,
  subtitle,
  closeHref,
  openHref,
  openLabel = "Open the full record",
  children,
  footer,
  nav,
}: {
  title: string;
  subtitle?: string | null;
  /** Where the close control goes: the same list, without the peek. */
  closeHref: string;
  /** The full record this is a summary of. */
  openHref: string;
  openLabel?: string;
  children: ReactNode;
  /**
   * Controls that act on the record, pinned to the foot.
   *
   * The drawer was read-only, which made it a place to confirm you had the
   * right row and then go somewhere else to do anything about it. A control
   * that scrolls away with the facts above it is a control nobody uses, so
   * these do not scroll.
   */
  footer?: ReactNode;
  /**
   * Where this record sits in the list behind the drawer.
   *
   * Without it a peek is a dead end: you read one, close it, find your place
   * again, and open the next. With it the list can be walked from inside the
   * drawer, which is the whole difference between checking one row and going
   * through twenty.
   */
  nav?: {
    prevHref: string | null;
    nextHref: string | null;
    index: number;
    total: number;
  };
}) {
  return (
    <aside
      aria-label="Record details"
      className="fixed inset-0 z-[65] flex flex-col overflow-hidden border-border/55 bg-background lg:static lg:inset-auto lg:z-auto lg:w-[340px] lg:shrink-0 lg:border-l dark:border-white/10"
    >
      <header className="shrink-0 border-b border-border/55 px-4 py-3 dark:border-white/10">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium text-foreground">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <Link
            href={closeHref}
            aria-label="Close details"
            className="tap shrink-0 text-sm text-slate-500 hover:text-accent"
          >
            Close
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={openHref} className="btn-ghost inline-flex text-xs">
            {openLabel}
          </Link>
          {nav && (
            <span className="ml-auto flex items-center gap-1">
              <Link
                href={nav.prevHref ?? "#"}
                aria-disabled={nav.prevHref == null}
                className={`tap rounded border border-border/60 px-2 py-1 text-xs dark:border-white/10 ${
                  nav.prevHref
                    ? "text-foreground hover:border-foreground/30"
                    : "pointer-events-none text-muted-foreground opacity-50"
                }`}
              >
                <span aria-hidden>↑</span>
                <span className="sr-only">Previous record</span>
              </Link>
              <span className="num px-1 text-xs text-muted-foreground">
                {nav.index + 1} of {nav.total}
              </span>
              <Link
                href={nav.nextHref ?? "#"}
                aria-disabled={nav.nextHref == null}
                className={`tap rounded border border-border/60 px-2 py-1 text-xs dark:border-white/10 ${
                  nav.nextHref
                    ? "text-foreground hover:border-foreground/30"
                    : "pointer-events-none text-muted-foreground opacity-50"
                }`}
              >
                <span aria-hidden>↓</span>
                <span className="sr-only">Next record</span>
              </Link>
            </span>
          )}
        </div>
      </header>
      {/*
        * The bottom padding is the mobile tab bar, the same allowance
        * `.page-main` makes. A `fixed inset-0` sheet escapes that padding, so
        * without this the last section of every drawer scrolls underneath the
        * tab bar and the reader concludes the record simply ends there. Raising
        * the z-index instead does not work: an ancestor creates a stacking
        * context, so the sheet cannot climb above the bar from inside it.
        */}
      {/*
        * `pt-4` rather than `py-4` on purpose: the bottom padding comes from
        * `.drawer-scroll`, and a Tailwind utility would have won over it. That
        * is exactly what happened on the first attempt, and the symptom was
        * the last section still sitting under the tab bar with a rule in the
        * stylesheet that said otherwise.
        */}
      <div className="scroll-thin drawer-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-4">
        {children}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-border/55 bg-background px-4 py-3 dark:border-white/10">
          {footer}
        </div>
      )}
    </aside>
  );
}

/**
 * One labelled fact.
 *
 * `value` of null renders the reason rather than a blank or a zero, because a
 * drawer full of empty rows reads as a broken query and a drawer full of
 * zeroes reads as a subcontractor who has done nothing.
 */
export function DrawerFact({
  label,
  value,
  unknown = "Not recorded",
  hint,
}: {
  label: string;
  value: ReactNode | null | undefined;
  unknown?: string;
  hint?: string;
}) {
  const empty = value == null || value === "";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-sm ${empty ? "text-slate-500" : "text-foreground"}`}>
        {empty ? unknown : value}
      </dd>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="label mb-2">{title}</h3>
      <dl className="space-y-3">{children}</dl>
    </section>
  );
}
