import type { AutomationState } from "@/lib/app-settings";
import { ActionButton } from "@/components/action-button";
import { timeAgo } from "@/lib/format";

/**
 * Master kill switch. Pausing stops scheduled runs, queue enqueue, agent
 * execution, and outbound email/SMS. Operator login, password reset, and
 * billing stay available.
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
            {paused ? "Everything is paused" : "Automation is running"}
          </p>
          <p className="text-xs text-slate-500">
            {paused
              ? "No agents, scheduled jobs, pipeline moves, outreach email, digests, or SMS will run until you resume."
              : "Agents run on schedule, move opportunities forward, and can send outreach and alerts."}
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
            : "Pause absolutely everything? No agents, emails, SMS, SAM pulls, or queued jobs will run until you resume."
        }
      >
        {paused ? "Resume everything" : "Pause everything"}
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
        <span className="font-semibold">Everything is paused.</span> No monitoring, pipeline
        work, outreach email, digests, or SMS will happen until you resume.
      </p>
      <ActionButton endpoint="/api/automation" body={{ paused: false }} className="btn-primary text-xs">
        Resume everything
      </ActionButton>
    </div>
  );
}
