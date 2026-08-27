import type { OpportunityBrief } from "@/lib/domain/opportunity-brief";
import type { RequirementStateView } from "@/lib/domain/requirement-state";
import { REQUIREMENT_STATE_LABEL } from "@/lib/domain/requirement-state";

/**
 * The requirements somebody deciding whether to pursue has to know about, and
 * nothing else.
 *
 * Overview is meant to answer nine questions on one screen, and one of them is
 * "what would disqualify me". The full checklist answers a different question
 * -- "what is left to do, and who is doing it" -- and it runs to forty rows on
 * an ordinary solicitation. Putting the whole thing on Overview was the reason
 * Overview stopped fitting on a screen, and it also meant the tab named
 * Requirements contained the classification record instead of the
 * requirements.
 *
 * So this is the short version: what gets the bid thrown out, what nobody can
 * act on until the contracting officer answers, and a way to the real list. It
 * states the labels and no detail, because detail here would make it a second
 * copy of the checklist rather than a pointer to it.
 */
export function CriticalRequirements({
  brief,
  states,
}: {
  brief: OpportunityBrief;
  /** Recorded state per requirement id, when the caller has any. */
  states?: Record<string, RequirementStateView>;
}) {
  if (brief.empty) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <p className="label">Critical requirements</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          No submission requirements were extracted yet. Until the analysis finishes, treat
          the original solicitation as the source of truth for what has to be submitted.
        </p>
      </div>
    );
  }

  const stateOf = (id: string) => states?.[id]?.state ?? null;
  const clarify = brief.requirements.filter((r) => stateOf(r.id) === "needs_clarification");
  const fatal = brief.disqualifiers;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
          Critical requirements
        </h3>
        <a href="#requirements" className="text-xs text-accent hover:underline">
          All {brief.requirements.length} on the Requirements tab
        </a>
      </div>

      {clarify.length > 0 && (
        <div className="mb-3 rounded-md border border-review/40 bg-review/5 px-4 py-3">
          <p className="text-sm font-semibold text-review">
            {clarify.length === 1
              ? "One item needs a question put to the contracting officer"
              : `${clarify.length} items need a question put to the contracting officer`}
          </p>
          <ul className="mt-2 space-y-1">
            {clarify.slice(0, 4).map((r) => (
              <li key={r.id} className="text-sm text-foreground">
                {r.label}
              </li>
            ))}
          </ul>
          {clarify.length > 4 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              And {clarify.length - 4} more, on the Requirements tab.
            </p>
          )}
        </div>
      )}

      {fatal.length === 0 ? (
        <div className="rounded-md border border-border bg-surface px-4 py-3">
          {/*
            Not "nothing can disqualify you". The extraction found nothing that
            would, which is a statement about the extraction as much as about
            the solicitation, and on a scanned notice those are very different
            things.
          */}
          <p className="text-sm text-muted-foreground">
            The analysis did not find anything that would get the bid thrown out on its own.
            The full list of what has to be submitted is on the Requirements tab.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-risk/40 bg-risk/5 px-4 py-3">
          <p className="text-sm font-semibold text-risk">
            Miss any of these and the bid is rejected
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Not scored lower. Not evaluated at all.
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {fatal.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground"
              >
                <span>{r.label}</span>
                {stateOf(r.id) && (
                  <span className="badge bg-surface-raised text-slate-600">
                    {REQUIREMENT_STATE_LABEL[stateOf(r.id)!]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
