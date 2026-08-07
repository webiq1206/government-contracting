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
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>

      <p className="mt-3 text-sm text-slate-600">
        Complete these and the platform runs on its own: finding, scoring, and
        working opportunities with only a few minutes from you each day.
      </p>

      <ul className="mt-4 space-y-2">
        {remaining.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  <span className="mr-1.5 text-slate-500" aria-hidden>
                    ○
                  </span>
                  {item.label}
                </p>
                <p className="mt-0.5 pl-5 text-xs text-slate-500">{item.hint}</p>
              </div>
              <span className="btn-ghost pointer-events-none shrink-0 text-xs">Set up →</span>
            </Link>
          </li>
        ))}
      </ul>

      {checklist.done > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          {checklist.done} step{checklist.done === 1 ? "" : "s"} already done. Nice progress.
        </p>
      )}
    </div>
  );
}
