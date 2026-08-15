"use client";

import { useEffect, useRef } from "react";
import { journeySteps, PARTY_LABEL } from "@/lib/domain/journey";

/**
 * Horizontal step tracker showing where one opportunity is on the happy path:
 * every step completed so far (✓), the active step (pulsing, with who owns
 * it), and everything still ahead. Renders directly under the header on the
 * opportunity page so the operator sees "how far along is this, and whose
 * turn is it" before reading anything else.
 */
export function OpportunityJourney({
  stage,
  callsEnabled = true,
}: {
  stage: string;
  /** False on an email-only account: the call step is not drawn at all. */
  callsEnabled?: boolean;
}) {
  const rail = useRef<HTMLOListElement>(null);

  // On a phone the path is wider than the screen, and the step that matters is
  // the current one, not the first. Bring it into view rather than making the
  // reader swipe to find out where they are.
  //
  // Above the dismissed early-return on purpose: a hook that runs only for
  // some values of `stage` is a hook that changes order between renders.
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>("[data-current='true']");
    el?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [stage]);

  if (stage === "dismissed") {
    return (
      <p className="text-xs text-slate-500">
        This opportunity was dismissed and is out of the pipeline.
      </p>
    );
  }
  const steps = journeySteps(stage, { callsEnabled });
  const outcome = stage === "won" ? "won" : stage === "lost" ? "lost" : null;

  return (
    <ol
      ref={rail}
      className="hide-scrollbar flex flex-nowrap items-center overflow-x-auto text-xs sm:flex-wrap sm:gap-y-2 sm:overflow-visible"
    >
      {steps.map((step, i) => (
        <li
          key={step.stage}
          data-current={step.status === "current"}
          className="flex shrink-0 items-center"
        >
          {i > 0 && (
            <span
              aria-hidden
              className={`mx-1.5 h-px w-4 sm:w-6 ${
                step.status === "upcoming" ? "bg-border" : "bg-pursue/50"
              }`}
            />
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              step.status === "done"
                ? "border-pursue/30 bg-pursue/10 text-pursue"
                : step.status === "current"
                  ? "border-pursue bg-pursue-soft font-semibold text-pursue-strong"
                  : "border-border bg-surface text-slate-500"
            }`}
          >
            {step.status === "done" ? (
              <span aria-hidden>✓</span>
            ) : step.status === "current" ? (
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-pursue"
              />
            ) : null}
            {step.label}
            {step.status === "current" && (
              <span className="font-normal text-slate-500">
                · {PARTY_LABEL[step.owner]}
              </span>
            )}
          </span>
        </li>
      ))}
      {outcome && (
        <li className="flex items-center">
          <span aria-hidden className="mx-1.5 h-px w-4 bg-pursue/50 sm:w-6" />
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${
              outcome === "won"
                ? "border-pursue/40 bg-pursue/10 text-pursue"
                : "border-risk/40 bg-risk/10 text-risk"
            }`}
          >
            {outcome === "won" ? "Won 🎉" : "Lost"}
          </span>
        </li>
      )}
    </ol>
  );
}
