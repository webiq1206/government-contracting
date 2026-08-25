import type { AutomationState } from "@/lib/app-settings";
import { ActionButton } from "@/components/action-button";
import { timeAgo } from "@/lib/format";

/**
 * Master kill switch. Pausing stops scheduled runs, queue enqueue, agent
 * execution, and outbound email/SMS. Operator login, password reset, and
 * billing stay available.
 *
 * This control describes the SWITCH, not the outcome. It used to say
 * "Automation is running -- agents run on schedule, move opportunities
 * forward, and can send outreach and alerts", which is a claim about work
 * getting done that a switch position cannot support. Sitting directly above
 * the health panel, it produced the contradiction in miniature: green "running"
 * two inches above red "blocked", on one screen. A switch can only honestly
 * report which way it is set; whether anything happens as a result is the
 * health model's question, and `healthy` lets this defer to it.
 */
export function AutomationControl({
  state,
  /** False when the health model has found something wrong. */
  healthy = true,
}: {
  state: AutomationState;
  healthy?: boolean;
}) {
  const { paused, changed_at, changed_by } = state;
  return (
    <div
      className={`card flex flex-wrap items-center justify-between gap-3 border-l-4 ${
        paused || !healthy ? "border-l-review" : "border-l-pursue"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`h-3 w-3 shrink-0 rounded-full ${
            paused ? "bg-review" : healthy ? "animate-pulse bg-pursue" : "bg-review"
          }`}
        />
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {paused ? "Everything is paused" : "Automation is switched on"}
          </p>
          <p className="text-xs text-slate-500">
            {paused
              ? "No agents, scheduled jobs, pipeline moves, outreach email, digests, or SMS will run until you resume."
              : healthy
                ? "Agents are allowed to run on schedule, move opportunities forward, and send outreach and alerts."
                : "Agents are allowed to run, but something is stopping them. See the state below."}
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
export function AutomationPausedBanner({
  state,
  variant: _variant = "light",
}: {
  state: AutomationState;
  /** @deprecated Theme tokens cover both surfaces; kept for call-site compatibility. */
  variant?: "light" | "shell";
}) {
  if (!state.paused) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-review/40 bg-review/10 px-4 py-3">
      <p className="text-sm text-foreground">
        <span className="font-semibold">Everything is paused.</span> No monitoring, pipeline
        work, outreach email, digests, or SMS will happen until you resume.
      </p>
      <ActionButton endpoint="/api/automation" body={{ paused: false }} className="btn-primary text-xs">
        Resume everything
      </ActionButton>
    </div>
  );
}
