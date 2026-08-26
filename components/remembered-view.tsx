"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Puts back the view somebody left on a page, and says that is what happened.
 *
 * The filter bar remembers its own filters and sort. This exists for the pages
 * whose state is larger than that: the pipeline has three views, and the one
 * an operator chose lived only in the URL, so leaving and coming back through
 * the sidebar dropped them into the default with their filters gone. The bar
 * could not fix it on its own, because it is only mounted in one of the three.
 *
 * A page uses this OR the filter bar's own memory, never both: two things
 * restoring the same URL would fight over it on arrival.
 *
 * Restoring is never silent. The notice is small, but the alternative is a
 * page that looks different from the one somebody expected with no explanation
 * on screen, which is the "why is this list empty" trap arrived at from a new
 * direction.
 */
export function RememberedView({
  storageKey,
  pathname,
  query,
  label,
}: {
  storageKey: string;
  pathname: string;
  /**
   * The canonical query for what is on screen, built from parsed values rather
   * than copied off the address bar. Anything page-local (an open drawer, a
   * selected record) must be left out, or it is stored and replayed days later
   * on a record somebody has moved on from.
   */
  query: string;
  /** What was put back, in the operator's words. */
  label: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [restored, setRestored] = useState(false);
  const checked = useRef(false);
  const restoredQuery = useRef<string | null>(null);
  const firstPass = useRef(true);

  const lastKey = `${storageKey}.last`;
  const restoredKey = `${storageKey}.restored`;

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    let saved: string | null = null;
    let wasRestored = false;
    try {
      saved = window.localStorage.getItem(lastKey);
      wasRestored = window.sessionStorage.getItem(restoredKey) === "1";
    } catch {
      return;
    }
    if (search.toString() !== "") {
      // Something was asked for, including possibly by our own replace below.
      // Keeping the notice through that survives the remount a replace can
      // cause; a notice that flashes and vanishes is worse than none.
      if (wasRestored) setRestored(true);
      return;
    }
    if (!saved) return;
    try {
      window.sessionStorage.setItem(restoredKey, "1");
    } catch {
      /* the notice is a nicety; the restore is not */
    }
    setRestored(true);
    restoredQuery.current = saved;
    router.replace(`${pathname}?${saved}`);
  }, [lastKey, restoredKey, pathname, router, search]);

  useEffect(() => {
    /*
     * The first pass writes only when something was actually asked for.
     *
     * On a bare arrival the query is empty and storing that would erase the
     * memory before the restore above can use it. On an arrival WITH
     * parameters, though, somebody opened a bookmark or followed a link to a
     * particular view, and skipping the write meant that view was forgotten
     * the moment they left: every full page load remounts this, so the skip
     * applied to real arrivals rather than only to bare ones.
     */
    if (firstPass.current) {
      firstPass.current = false;
      if (query === "") return;
    }
    const isOurRestore = query === restoredQuery.current;
    try {
      window.localStorage.setItem(lastKey, query);
      if (!isOurRestore) window.sessionStorage.removeItem(restoredKey);
    } catch {
      // Storage off: the URL still holds the view for as long as you stay on it.
    }
    if (!isOurRestore) {
      restoredQuery.current = null;
      setRestored(false);
    }
  }, [query, lastKey, restoredKey]);

  if (!restored) return null;
  return (
    <p className="px-4 pt-2 text-xs text-muted-foreground sm:px-5">
      {label}{" "}
      {/*
        * Forgets before it navigates. A plain link to the bare path would be
        * restored again on arrival, which is a control that appears not to
        * work: you press it, the page reloads, and nothing has changed.
        */}
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.removeItem(lastKey);
            window.sessionStorage.removeItem(restoredKey);
          } catch {
            /* ignore */
          }
          restoredQuery.current = null;
          setRestored(false);
          router.replace(pathname);
        }}
        className="underline underline-offset-2 hover:text-foreground"
      >
        Start fresh
      </button>
    </p>
  );
}
