import Link from "next/link";
import { ActionButton } from "./action-button";
import { deriveStep, PARTY_LABEL, type StepInput } from "@/lib/domain/journey";

/**
 * Stage-aware guidance shown at the top of the opportunity detail page.
 * Renders the single recommended next action from lib/domain/journey, so the
 * operator never has to work out what comes next: what's happening, who the
 * ball is with, what to do, and what the platform does right after. When the
 * next action is a decision only the operator can make (pursue/pass,
 * won/lost), the buttons live right here in the banner, one tap from the top
 * of the page on every device.
 */
export function NextStepBanner(props: StepInput & { opportunityId: string }) {
  const { opportunityId, ...input } = props;
  const step = deriveStep(input);
  if (!step) return null;

  const hasLink = Boolean(step.cta && (step.href || step.anchor));

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 ${
        step.tone === "action"
          ? "border-pursue/40 bg-pursue-soft"
          : step.tone === "warn"
            ? "border-review/40 bg-review/5"
            : "border-border bg-surface"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">
            Next step: {step.title}
          </p>
          <span
            className={`badge ${
              step.waitingOn === "you"
                ? "bg-pursue/10 text-pursue"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            waiting on {PARTY_LABEL[step.waitingOn]}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-slate-600">{step.why}</p>
        {step.after && (
          <p className="mt-0.5 text-xs text-slate-500">Then: {step.after}</p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {step.decision === "triage" && (
          <>
            <ActionButton
              endpoint={`/api/opportunities/${opportunityId}/action`}
              body={{ action: "pursue" }}
              className="btn-success text-xs"
            >
              Pursue
            </ActionButton>
            <ActionButton
              endpoint={`/api/opportunities/${opportunityId}/action`}
              body={{ action: "dismiss" }}
              className="btn-danger text-xs"
              toast={{
                message: "Dismissed. It's archived, not deleted.",
                undo: {
                  endpoint: `/api/opportunities/${opportunityId}/action`,
                  body: { action: "restore" },
                },
              }}
            >
              Dismiss
            </ActionButton>
          </>
        )}
        {step.decision === "outcome" && (
          <>
            <ActionButton
              endpoint={`/api/opportunities/${opportunityId}/outcome`}
              body={{ outcome: "won" }}
              className="btn-success text-xs"
              confirm="Mark as WON and create the contract?"
            >
              Mark won
            </ActionButton>
            <ActionButton
              endpoint={`/api/opportunities/${opportunityId}/outcome`}
              body={{ outcome: "lost" }}
              className="btn-danger text-xs"
              confirm="Mark this bid as lost?"
            >
              Mark lost
            </ActionButton>
          </>
        )}
        {hasLink && step.href && (
          <Link
            href={step.href}
            className={`${step.decision ? "btn-ghost" : "btn-primary"} text-xs`}
          >
            {step.cta} →
          </Link>
        )}
        {hasLink && !step.href && step.anchor && (
          <a
            href={step.anchor}
            className={`${step.decision ? "btn-ghost" : "btn-primary"} text-xs`}
          >
            {step.cta} {step.decision ? "" : "↓"}
          </a>
        )}
      </div>
    </div>
  );
}
