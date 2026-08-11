"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { ActionButton } from "./action-button";
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

  return (
    <div
      id="next-step"
      className={`scroll-mt-12 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3.5 ${
        step.tone === "action"
          ? "focus-rail border-pursue/40 bg-pursue-soft"
          : step.tone === "warn"
            ? "focus-rail border-review/40 bg-review/5"
            : "focus-rail border-border bg-surface"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow-gold">Next step</p>
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
        <p className="mt-1 text-base font-semibold text-foreground">{step.title}</p>
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
          <Link href={step.href} className={linkClass}>
            {step.cta} →
          </Link>
        )}
        {hasLink && !step.href && step.anchor && (
          <a
            href={step.anchor}
            className={linkClass}
            onClick={(e) => openInPageTarget(e, step.anchor!)}
          >
            {step.cta} {step.decision ? "" : "↓"}
          </a>
        )}
      </div>
    </div>
  );
}

/** Open the matching editorial tab before scrolling to an in-page target. */
function openInPageTarget(e: MouseEvent<HTMLAnchorElement>, anchor: string) {
  const target = anchor.replace(/^#/, "");
  if (!target || typeof window === "undefined") return;
  e.preventDefault();
  window.dispatchEvent(
    new CustomEvent("editorial-open-tab", { detail: { target } })
  );
  const url = new URL(window.location.href);
  url.hash = target;
  window.history.replaceState(null, "", url.toString());
  window.requestAnimationFrame(() => {
    const el =
      document.querySelector<HTMLElement>(`[data-guide-target="${target}"]`) ||
      document.getElementById(target);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
