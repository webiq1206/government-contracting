"use client";

import { useEffect, useRef } from "react";
import { journeySteps, type JourneyCompletion } from "@/lib/domain/journey";

/**
 * Completion evidence and saved stage are separate. A later stage cannot
 * turn missing source, qualification, or contact evidence into checkmarks.
 */
export function OpportunityJourney({
  stage,
  completion,
  callsEnabled = true,
}: {
  stage: string;
  completion: JourneyCompletion;
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
    const container = rail.current;
    const el = container?.querySelector<HTMLElement>("[data-current='true']");
    if (!container || !el || container.scrollWidth <= container.clientWidth) return;
    // Only move this horizontal rail. scrollIntoView also moved the record's
    // vertical scroller, hiding its title as soon as the page opened.
    container.scrollTo({
      left: container.scrollLeft + el.getBoundingClientRect().left - container.getBoundingClientRect().left - (container.clientWidth - el.clientWidth) / 2,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [stage, callsEnabled]);

  if (stage === "dismissed") {
    return (
      <p className="text-xs text-slate-500">
        This opportunity was dismissed and is out of the pipeline.
      </p>
    );
  }
  const steps = journeySteps(stage, { callsEnabled, completion });
  const outcome = stage === "won" ? "won" : stage === "lost" ? "lost" : null;

  return (
    <ol
      ref={rail}
      className="hide-scrollbar flex flex-nowrap items-center overflow-x-auto text-xs sm:flex-wrap sm:gap-y-2 sm:overflow-visible"
    >
      {steps.map((step, i) => (
        <li
          key={step.stage}
          data-current={step.recordedStage}
          aria-label={`${step.label}: ${step.status === "done" ? "complete" : "completion not verified"}${step.recordedStage ? "; recorded stage" : ""}`}
          className="flex shrink-0 items-center"
        >
          {i > 0 && (
            <span
              aria-hidden
              className={`mx-1.5 h-px w-4 sm:w-6 ${
                step.status === "done" ? "bg-pursue/50" : "bg-border"
              }`}
            />
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              step.status === "done"
                ? "border-pursue/30 bg-pursue/10 text-pursue"
                : step.recordedStage
                  ? "border-pursue bg-pursue-soft font-semibold text-pursue-strong"
                  : "border-border bg-surface text-slate-500"
            }`}
          >
            {step.status === "done" ? (
              <span aria-hidden>✓</span>
            ) : step.recordedStage ? (
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-pursue"
              />
            ) : null}
            {step.label}
            {step.recordedStage && (
              <span className="font-normal text-slate-500">
                · recorded stage
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
