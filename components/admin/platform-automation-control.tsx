import type { AutomationState } from "@/lib/app-settings";
import { ActionButton } from "@/components/action-button";
import { timeAgo } from "@/lib/format";

export function PlatformAutomationControl({ state }: { state: AutomationState }) {
  return (
    <section
      aria-labelledby="platform-emergency-stop"
      className={`rounded-md border-l-4 p-4 ${
        state.paused
          ? "border border-risk/50 border-l-risk bg-risk/10"
          : "border border-border border-l-pursue bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow-gold">Emergency control</p>
          <h2 id="platform-emergency-stop" className="mt-1 font-display text-lg font-semibold">
            {state.paused ? "Automation is paused for every account" : "Platform automation is enabled"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.paused
              ? "No account can start scheduled work, queue new jobs, or send automated outreach and alerts until this is resumed."
              : "Every account may run automation unless that account has paused its own switch."}
            {state.changed_at && state.changed_by
              ? ` Last changed ${timeAgo(state.changed_at)} by ${state.changed_by}.`
              : " This platform control has not been used."}
          </p>
        </div>
        <ActionButton
          endpoint="/api/admin/automation"
          body={{ paused: !state.paused }}
          className={state.paused ? "btn-primary" : "btn-danger"}
          confirm={
            state.paused
              ? "Resume automation for every account?"
              : "Pause automation for every account?"
          }
          confirmBody={
            state.paused
              ? "New work and sends can start again immediately. Account-level pauses will remain unchanged."
              : "This immediately blocks new scheduled jobs, queue entries, automated outreach, alerts, and sends across the platform."
          }
          confirmLabel={state.paused ? "Resume platform" : "Pause platform"}
          danger={!state.paused}
          successText={state.paused ? "Platform automation resumed" : "Platform automation paused"}
        >
          {state.paused ? "Resume platform" : "Pause platform"}
        </ActionButton>
      </div>
    </section>
  );
}
