"use client";

import { useEffect, useState } from "react";

/**
 * What each industry code is actually bringing in.
 *
 * The code list is the filter the opportunity feed runs on, and it is edited
 * as a row of chips with nothing to say what any of them does. Removing one is
 * a decision about the pipeline taken with no information: somebody tidying a
 * list they no longer recognize can switch off the source of half their work
 * and find out six weeks later, when the feed is thin and nothing points back
 * at the chip they deleted.
 *
 * Counted over what is open now rather than over all history, because "what
 * would I stop seeing" is the question being asked.
 */

interface Counts {
  counts: { code: string; open: number; pursued: number }[];
  unlisted?: { code: string | null; open: number }[];
}

export function NaicsImpact({ codes }: { codes: string[] }) {
  const [data, setData] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);
  const key = codes.join(",");

  useEffect(() => {
    if (!key) {
      setData(null);
      return;
    }
    let live = true;
    setFailed(false);
    /*
     * Debounced, because this runs on every keystroke in a token field. The
     * delay is long enough that picking three codes in a row is one request.
     */
    const timer = setTimeout(() => {
      fetch(`/api/profile/naics-impact?codes=${encodeURIComponent(key)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: Counts) => live && setData(d))
        .catch(() => live && setFailed(true));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  if (!key) return null;
  if (failed) {
    /*
     * Says so rather than showing nothing. An impact panel that silently
     * disappears looks identical to one reporting that no code matches
     * anything, and those are opposite conclusions.
     */
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Could not count what these codes are bringing in just now. The codes themselves are
        unaffected.
      </p>
    );
  }
  if (!data) {
    return <p className="mt-3 text-xs text-muted-foreground">Counting open work by code…</p>;
  }

  const withWork = data.counts.filter((c) => c.open > 0).sort((a, b) => b.open - a.open);
  const idle = data.counts.filter((c) => c.open === 0);

  return (
    <div className="mt-3 rounded-md border border-border bg-surface p-3">
      <p className="label mb-2">What these codes are bringing in</p>

      {withWork.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-600">
          None of these codes has open work against it right now. That is normal on a new
          account, and worth a second look on an established one.
        </p>
      ) : (
        <ul className="space-y-1">
          {withWork.map((c) => (
            <li key={c.code} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="num font-medium text-slate-800">{c.code}</span>
              <span className="text-slate-600">
                {c.open} open
                {c.pursued > 0 ? `, ${c.pursued} being pursued` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {idle.length > 0 && withWork.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {idle.length === 1
            ? `${idle[0].code} has nothing open against it.`
            : `${idle.length} of these codes have nothing open against them: ${idle
                .map((c) => c.code)
                .join(", ")}.`}
        </p>
      )}

      {(data.unlisted?.length ?? 0) > 0 && (
        /*
         * The other half of the question. Open work carrying a code that is
         * not on the list arrived under an older profile or by hand, and the
         * feed will not find more like it.
         */
        <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-slate-600">
          Open work carries {data.unlisted!.length === 1 ? "a code" : "codes"} not on this
          list:{" "}
          {data.unlisted!.map((u) => `${u.code} (${u.open})`).join(", ")}. The feed will not
          find more of it unless you add {data.unlisted!.length === 1 ? "that code" : "them"}.
        </p>
      )}
    </div>
  );
}
