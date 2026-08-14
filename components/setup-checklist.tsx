import Link from "next/link";
import type { SetupChecklist as Checklist } from "@/lib/domain/setup";

/**
 * The guided setup card on Today. Shows overall progress and the remaining
 * steps, each a deep link to where it's completed. Renders nothing once
 * everything is done, so it "holds the operator's hand" only until the platform
 * is ready to run on its own, then gets out of the way.
 */
export function SetupChecklist({ checklist }: { checklist: Checklist }) {
  if (checklist.complete) return null;

  const remaining = checklist.items.filter((i) => !i.done);
  const finished = checklist.items.filter((i) => i.done);
  const pct = Math.round((checklist.done / checklist.total) * 100);

  return (
    <div className="rounded-md border border-accent/40 bg-accent-soft p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow text-accent-strong">Finish setting up</p>
          <h2 className="mt-0.5 font-display text-2xl font-semibold text-foreground">
            {checklist.done} of {checklist.total} steps done
          </h2>
        </div>
        <span className="num text-sm text-slate-500">{pct}%</span>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full bg-pursue" style={{ width: `${pct}%` }} />
      </div>

      <p className="mt-3 text-sm text-slate-600">
        Complete these and the platform runs on its own: finding, scoring, and
        working opportunities with only a few minutes from you each day.
      </p>

      {/* The specific trap: a connected SAM key with no NAICS codes looks
          finished and finds nothing, because the monitor skips federal
          ingestion outright. Say so where the customer is already looking. */}
      {checklist.discoveryStalled && (
        <p className="mt-3 rounded-md border border-risk/40 bg-risk/5 px-3 py-2.5 text-sm leading-relaxed text-risk">
          SAM.gov is connected, but no searches can run yet: Brost Co searches one NAICS code
          at a time, and your profile has none. Add them and opportunities start arriving on
          the next run.
        </p>
      )}

      {checklist.requiredRemaining > 0 && !checklist.discoveryStalled && (
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          {checklist.requiredRemaining === 1
            ? "The step marked Required is the last one standing between you and a working pipeline. Everything else improves what you get."
            : `The ${checklist.requiredRemaining} steps marked Required are what make the platform work: finding opportunities, scoring them, and sourcing subcontractors. Everything else improves what you get.`}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {remaining.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-slate-900">
                  <span className="text-slate-500" aria-hidden>
                    ○
                  </span>
                  {item.label}
                  {item.required && (
                    <span className="badge bg-risk/15 text-risk">Required</span>
                  )}
                </p>
                <p className="mt-0.5 pl-5 text-xs text-slate-500">{item.hint}</p>
              </div>
              <span className="btn-ghost pointer-events-none shrink-0 text-xs">Set up →</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Completed steps are listed, not just counted. "1 of 8 done" above a
          list of seven open items is arithmetic the reader has to do, and
          leaves them unable to see WHICH step they apparently finished. */}
      {finished.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500">
            {finished.length} step{finished.length === 1 ? "" : "s"} already done
          </summary>
          <ul className="mt-2 space-y-1.5">
            {finished.map((item) => (
              <li key={item.key} className="flex items-start gap-2 pl-1 text-xs">
                <span className="text-pursue" aria-hidden>
                  ✓
                </span>
                <span className="text-slate-600">
                  {item.label}
                  <Link href={item.href} className="ml-2 text-accent hover:underline">
                    Change
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
