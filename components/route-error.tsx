"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * What a route boundary is allowed to say.
 *
 * "Something went wrong" is banned everywhere the system knows the cause. A
 * React error boundary is one of the few places it genuinely does not: Next
 * replaces the message with a generic one in production builds and hands over
 * only a `digest`, precisely so a stack trace cannot leak to a browser. So the
 * honest version does not pretend to a diagnosis. It says what it does know,
 * which is more than the old screen said:
 *
 *   - the page failed to render
 *   - a preceding action may have completed, so check before repeating it
 *   - the digest, which is the one string that lets support find the trace
 *   - where the system-wide answer lives, if it is not just this page
 *
 * The digest is the part that was missing and the part that matters. Without
 * it a support conversation starts with "which error?" and never recovers.
 */
export function RouteError({
  error,
  reset,
  scope,
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** For the console line, so two boundaries are told apart in a log. */
  scope: string;
  backHref: string;
  backLabel: string;
}) {
  useEffect(() => {
    console.error(`[${scope}] render error:`, error);
  }, [error, scope]);

  return (
    <div className="flex page-shell items-center justify-center p-6">
      <div className="mx-auto max-w-lg rounded-md border border-risk/30 bg-risk/5 p-6 text-center">
        <h1 className="font-display text-xl font-semibold text-foreground">
          This page did not load
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We could not display this page. Try loading it again. If you had just
          saved or sent something, check its status before repeating the action
          to avoid a duplicate.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => reset()} className="btn-primary">
            Try again
          </button>
          <Link href={backHref} className="btn-ghost">
            {backLabel}
          </Link>
          <Link href="/agents" className="btn-ghost">
            Check Automation Health
          </Link>
        </div>
        {error.digest && (
          /* Monospace and selectable: someone is going to read this down a
             phone line or paste it into a support message. */
          <p className="mt-4 select-all font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
