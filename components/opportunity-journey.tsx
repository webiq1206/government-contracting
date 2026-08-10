import { journeySteps, PARTY_LABEL } from "@/lib/domain/journey";

/**
 * Horizontal step tracker showing where one opportunity is on the happy path:
 * every step completed so far (✓), the active step (pulsing, with who owns
 * it), and everything still ahead. Renders directly under the header on the
 * opportunity page so the operator sees "how far along is this, and whose
 * turn is it" before reading anything else.
 */
export function OpportunityJourney({ stage }: { stage: string }) {
  if (stage === "dismissed") {
    return (
      <p className="text-xs text-slate-500">
        This opportunity was dismissed and is out of the pipeline.
      </p>
    );
  }
  const steps = journeySteps(stage);
  const outcome = stage === "won" ? "won" : stage === "lost" ? "lost" : null;

  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-xs">
      {steps.map((step, i) => (
        <li key={step.stage} className="flex items-center">
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
