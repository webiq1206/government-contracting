"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { ActionButton } from "./action-button";
import { openEditorialTarget } from "@/lib/editorial-nav";
import { deriveStep, PARTY_LABEL, type StepInput } from "@/lib/domain/journey";

/**
 * Stage-aware guidance shown at the top of the opportunity detail page.
 * Always renders a recommended next action with a concrete CTA (route, in-page
 * link, or decision buttons) so the operator can complete the task from here.
 */
export function NextStepBanner(props: StepInput & { opportunityId: string }) {
  const { opportunityId, ...input } = props;
  const step = deriveStep(input);
  const hasLink = Boolean(step.cta && (step.href || step.anchor));
  const linkClass = `${step.decision ? "btn-ghost" : "btn-primary"} text-xs`;
  const waitingBadge =
    step.waitingOn === "you"
      ? "bg-pursue/10 text-pursue"
      : step.waitingOn === "system"
        ? "bg-gold/15 text-foreground"
        : "bg-muted text-muted-foreground";
  const waitingText =
    step.waitingOn === "you"
      ? "Action required"
      : `Waiting on ${PARTY_LABEL[step.waitingOn]}`;

  return (
    <div
      id="next-step"
      className={`scroll-mt-editorial flex flex-wrap items-center justify-between gap-3 rounded-md border border-l-4 px-4 py-4 sm:px-5 ${
        step.tone === "action"
          ? "border-pursue/40 border-l-pursue bg-pursue-soft"
          : step.tone === "warn"
            ? "border-review/40 border-l-review bg-review/10"
            : "border-border border-l-gold bg-surface"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
            Next step
          </h2>
          <span className={`badge ${waitingBadge}`}>{waitingText}</span>
        </div>
        <p className="mt-1.5 text-base font-semibold text-foreground">{step.title}</p>
        <p className="mt-0.5 text-sm text-slate-600">{step.why}</p>
        {step.after && (
          <p className="mt-2 text-sm text-slate-700">
            <span className="font-semibold text-foreground">What happens next: </span>
            {step.after}
          </p>
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
          <Link href={step.href} className={linkClass}>
            {step.cta} →
          </Link>
        )}
        {hasLink && !step.href && step.anchor && (
          <a
            href={step.anchor}
            className={linkClass}
            onClick={(e) => {
              e.preventDefault();
              openEditorialTarget(step.anchor!);
            }}
          >
            {step.cta} {step.decision ? "" : "↓"}
          </a>
        )}
      </div>
    </div>
  );
}

/** @deprecated Prefer openEditorialTarget from lib/editorial-nav. */
export function openInPageTarget(e: MouseEvent<HTMLAnchorElement>, anchor: string) {
  e.preventDefault();
  openEditorialTarget(anchor);
}
