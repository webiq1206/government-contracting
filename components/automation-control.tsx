import type { AutomationState } from "@/lib/app-settings";
import { ActionButton } from "@/components/action-button";
import { timeAgo } from "@/lib/format";

/**
 * The automation master switch. Pausing stops the cron scheduler from starting
 * new runs; manual "Run now" and jobs already in the queue still process, so
 * pausing is always safe and instantly reversible.
 */
export function AutomationControl({ state }: { state: AutomationState }) {
  const { paused, changed_at, changed_by } = state;
  return (
    <div
      className={`card flex flex-wrap items-center justify-between gap-3 border-l-4 ${
        paused ? "border-l-review" : "border-l-pursue"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`h-3 w-3 shrink-0 rounded-full ${
            paused ? "bg-review" : "animate-pulse bg-pursue"
          }`}
        />
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {paused ? "Automation is paused" : "Automation is running"}
          </p>
          <p className="text-xs text-slate-500">
            {paused
              ? "No new scheduled runs will start. Manual runs and already-queued jobs still process."
              : "Agents run on their schedules and move opportunities forward automatically."}
            {changed_at && changed_by
              ? ` Last changed ${timeAgo(changed_at)} by ${changed_by}.`
              : ""}
          </p>
        </div>
      </div>
      <ActionButton
        endpoint="/api/automation"
        body={{ paused: !paused }}
        className={paused ? "btn-primary" : "btn-ghost"}
        confirm={
          paused
            ? undefined
            : "Pause all scheduled automation? Nothing new will run until you resume. Manual runs stay available."
        }
      >
        {paused ? "Resume automation" : "Pause automation"}
      </ActionButton>
    </div>
  );
}

/** Compact site-wide warning shown (only) while automation is paused. */
export function AutomationPausedBanner({ state }: { state: AutomationState }) {
  if (!state.paused) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-review/40 bg-review/10 px-4 py-3">
      <p className="text-sm text-slate-800">
        <span className="font-semibold">Automation is paused.</span> Opportunities are not being
        monitored or moved forward. Nothing new will happen until you resume.
      </p>
      <ActionButton endpoint="/api/automation" body={{ paused: false }} className="btn-primary text-xs">
        Resume automation
      </ActionButton>
    </div>
  );
}
