import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/badges";
import type { HelpContent } from "@/components/help-popover";

/**
 * The frame every page wears.
 *
 * Three things were missing and each cost an operator the same thing: knowing
 * where they are.
 *
 * A breadcrumb, because the sidebar says which SECTION you are in and nothing
 * says which record. On an opportunity three levels deep the only way back to
 * the list was the browser's Back button, and the only way to know which
 * opportunity you had open was to read the title and hope.
 *
 * A one-sentence explanation, because a page named "Review" or "Authority"
 * tells a new operator nothing, and the answer lived in a help popover they
 * had no reason to open.
 *
 * ONE primary action, named. Pages had grown three or four equally-weighted
 * buttons in the header, which is the same as having none: the operator has to
 * read all of them and decide, every time, on a page they visit daily. The
 * type only allows one, so the decision is made once by whoever builds the
 * page rather than repeatedly by whoever uses it.
 */

export interface Crumb {
  label: string;
  /** Omitted on the last crumb, which is where you already are. */
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {c.href && !last ? (
                <Link
                  href={c.href}
                  className="truncate underline-offset-2 hover:text-foreground hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  className={`truncate ${last ? "text-foreground" : ""}`}
                  aria-current={last ? "page" : undefined}
                >
                  {c.label}
                </span>
              )}
              {!last && <span aria-hidden>/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageFrame({
  title,
  /**
   * What this page is for, in one sentence, in the words an operator would
   * use. Not a feature description: "Every opportunity, by whose turn it is",
   * not "Opportunity management interface".
   */
  explanation,
  breadcrumbs = [],
  status,
  help,
  /**
   * The single most likely next action. One, deliberately.
   *
   * Secondary actions belong beside the thing they act on, not in the header
   * competing with the primary one.
   */
  primaryAction,
  children,
}: {
  title: string;
  explanation: string;
  breadcrumbs?: Crumb[];
  status?: ReactNode;
  help?: HelpContent;
  primaryAction?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      {breadcrumbs.length > 0 && (
        <div className="border-b border-border/40 bg-background px-4 pt-2 sm:px-6">
          <Breadcrumbs items={breadcrumbs} />
        </div>
      )}
      <PageHeader title={title} subtitle={explanation} status={status} help={help}>
        {primaryAction}
      </PageHeader>
      {children}
    </>
  );
}
