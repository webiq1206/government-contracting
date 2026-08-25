import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";

/**
 * The four things a page can be other than "here is your data".
 *
 * They were each handled differently wherever they came up, and two of them
 * were usually not handled at all. The pattern that matters is the same in all
 * four cases: say what happened, in the reader's terms, and give them the one
 * thing they can do about it. A state that only says "Error" leaves an
 * operator with nothing to do but reload and hope.
 *
 * Loading and Empty already existed. Error and Permission are the two that
 * were missing, and they are the two where a bad state does the most damage:
 * a failure that looks like emptiness makes an operator believe they have no
 * work, and a permission block with no explanation makes them believe the
 * product is broken.
 */

/** Skeleton rows, sized to what is coming, so the page does not jump. */
export function LoadingRows({
  rows = 6,
  label = "Loading",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="space-y-2 p-4 sm:p-5" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted/70" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted/50" />
        </div>
      ))}
    </div>
  );
}

/**
 * Something failed.
 *
 * Distinct from empty on purpose. An operator who cannot tell a failure from
 * an empty list concludes there is no work, and the difference between those
 * two readings is a missed deadline.
 */
export function ErrorState({
  title = "This did not load",
  detail,
  retry,
}: {
  title?: string;
  /** What actually went wrong, in words rather than a stack trace. */
  detail?: ReactNode;
  /** A retry control, when retrying is genuinely worth doing. */
  retry?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-md border border-risk/30 bg-risk/5 p-5 text-center sm:p-6">
      <p className="font-display text-xl font-normal text-foreground sm:font-semibold">
        {title}
      </p>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {detail ?? "Something went wrong on our side, so this page could not be filled in."}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Nothing has been changed or lost. This is a display problem, not a data one.
      </p>
      {retry && <div className="mt-4 flex flex-wrap justify-center gap-2">{retry}</div>}
    </div>
  );
}

/**
 * The reader is not allowed to see this.
 *
 * Says who can help rather than only that they cannot. "Access denied" with no
 * route forward reads as a broken product, and the operator's next move is to
 * ask whether the whole system is down.
 */
export function PermissionState({
  what = "this page",
  who = "an account owner or admin",
  backHref = "/today",
  backLabel = "Back to Today",
}: {
  what?: string;
  who?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <EmptyState
      title="You do not have access to this"
      description={
        <>
          Your account cannot open {what}. {who} can give you access from
          Settings. Nothing is wrong with your account or with the job you were
          looking at.
        </>
      }
      action={
        <Link href={backHref} className="btn-ghost text-xs">
          {backLabel}
        </Link>
      }
    />
  );
}

/**
 * Nothing here, and whether that is good or bad.
 *
 * A thin wrapper over EmptyState that forces the distinction: an empty inbox
 * after a day's work is success and should read as calm; an empty roster on
 * day one is a setup step and should read as a next action. The same grey box
 * for both is what makes an operator unsure which they are looking at.
 */
export function NothingHere({
  title,
  description,
  action,
  because = "nothing-to-do",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** "nothing-to-do" is success; "not-set-up-yet" needs the operator. */
  because?: "nothing-to-do" | "not-set-up-yet";
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={action}
      tone={because === "nothing-to-do" ? "success" : "neutral"}
    />
  );
}
