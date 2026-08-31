"use client";

/**
 * A reply the automatic reader would not act on, and the six things it could
 * have meant.
 *
 * This is the same decision Today's reply list has always offered, moved into
 * a screen that also shows the whole message, the solicitation it belongs to,
 * and what happens next. On Today it was a row in a stack of rows: the message
 * was truncated to 240 characters, the reason it was held sat above six
 * identical grey buttons, and answering one left the other eleven exactly
 * where they were.
 *
 * Answering here records the outcome and moves to the next item, which is the
 * only way a queue of eleven replies is eleven minutes rather than an
 * afternoon.
 */

import { AdvanceAction } from "@/components/workspace/advance-action";

/** The answers an operator can give, in the order they occur in real life. */
const CHOICES: { outcome: string; label: string; hint: string; primary?: boolean }[] = [
  {
    outcome: "quoted",
    label: "They gave a price",
    hint: "Records a quote for this trade and moves the bid on.",
    primary: true,
  },
  {
    outcome: "interested",
    label: "Interested, no price yet",
    hint: "Keeps the thread open and leaves the trade unpriced.",
  },
  {
    outcome: "unavailable",
    label: "Busy this time",
    hint: "Keeps them in the running for future work.",
  },
  {
    outcome: "not_a_fit",
    label: "Wrong scope for them",
    hint: "Applies to this scope only, not to future jobs.",
  },
  {
    outcome: "declined",
    label: "They said no",
    hint: "Passed on this solicitation.",
  },
  {
    outcome: "none",
    label: "Nothing to do",
    hint: "Dismisses the review without changing any record.",
  },
];

export function ReplyOutcomes({
  replyId,
  nextHref,
  doneHref,
  canAct,
}: {
  replyId: string;
  nextHref: string | null;
  doneHref: string;
  canAct: boolean;
}) {
  if (!canAct) {
    return (
      <p className="text-xs text-muted-foreground">
        You can read this reply but not record what it meant. An owner, admin,
        operator or estimator can.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <AdvanceAction
            key={c.outcome}
            endpoint={`/api/replies/${replyId}/review`}
            body={{ outcome: c.outcome }}
            nextHref={nextHref}
            doneHref={doneHref}
            className={`${c.primary ? "btn-primary" : "btn-ghost"} text-sm`}
            busyLabel="Saving…"
            shortcut={c.primary ? "mod+Enter" : undefined}
            toast={{ message: `Recorded: ${c.label.toLowerCase()}.` }}
          >
            {c.label}
        </AdvanceAction>
      ))}
    </div>
  );
}

/**
 * What each answer does, once, in the body rather than in the foot.
 *
 * Six tooltips would be invisible to a keyboard and to a phone, and these are
 * the sentences that tell somebody which of six near-synonyms to press. They
 * are read once and then never again, which is exactly the content that must
 * not be in a sticky footer: on a phone it turned the actions into two thirds
 * of the screen.
 */
export function ReplyOutcomeGuide() {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
      {CHOICES.map((c) => (
        <div key={c.outcome} className="flex gap-1.5">
          <dt className="shrink-0 font-medium text-foreground">{c.label}:</dt>
          <dd>{c.hint}</dd>
        </div>
      ))}
    </dl>
  );
}
