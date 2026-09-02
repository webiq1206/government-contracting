import Link from "next/link";
import {
  callReason,
  contactQuality,
  localTimeFor,
  nextCallWindow,
  callability,
  groupCalls,
  CONTACT_QUALITY_LABEL,
  type CallCardFacts,
  type CallGrouping,
  type CallRules,
} from "@/lib/domain/call-queue";
import { shortDate, countdown } from "@/lib/format";
import { RowActions } from "@/components/row-actions";
import { callCardRowActions } from "@/lib/domain/row-actions";
import { quickViewValue } from "@/lib/domain/quick-view";

/**
 * The queue, as rows somebody can decide from without opening anything.
 *
 * The audit lists exactly what a row needs: subcontractor, trade,
 * opportunity, deadline, last contact, contact quality, local time, and why
 * this call is happening. The last two were the ones missing and the ones
 * that cost most -- an operator who cannot see it is six in the morning where
 * the sub is finds out by dialling.
 */
export function CallQueueList({
  cards,
  grouping,
  selectedId,
  hrefBase,
  peekBase,
  now,
  rules,
  role,
}: {
  cards: CallCardFacts[];
  grouping: CallGrouping;
  selectedId: string | null;
  /** Prefix for a row's link, with the id appended. */
  hrefBase: string;
  /** Prefix for a quick-look link, with the encoded target appended. */
  peekBase: string;
  now: Date;
  /** The operator's calling window and attempt limit, from Automation Rules. */
  rules: CallRules;
  /** What the reader may do. Without it a row offers nothing. */
  role?: string | null;
}) {
  const groups = groupCalls(cards, grouping);

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.key}>
          {g.label && (
            <h2 className="label mb-2 truncate" title={g.label}>
              {g.label}
              <span className="num ml-2 text-muted-foreground">{g.cards.length}</span>
            </h2>
          )}
          <ul className="space-y-2">
            {g.cards.map((c) => {
              const t = localTimeFor(c.state, now, {
                start: rules.call_hours_start,
                end: rules.call_hours_end,
              });
              const quality = contactQuality(c);
              const call = callability(c, rules, now);
              const window_ = nextCallWindow(c.state, now, {
                start: rules.call_hours_start,
                end: rules.call_hours_end,
              });
              const active = c.id === selectedId;
              return (
                <li key={c.id}>
                  <Link
                    href={`${hrefBase}${c.id}`}
                    aria-current={active ? "true" : undefined}
                    className={`block rounded-md border px-3 py-2.5 transition-colors ${
                      active
                        ? "border-gold bg-gold/[0.08]"
                        : "border-border/55 hover:border-foreground/30 dark:border-white/10"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {c.companyName}
                      </span>
                      {/*
                        * The hour where they are, or an honest silence. A
                        * confident wrong time is worse than none: it is the
                        * difference between checking and dialling.
                        */}
                      {t.label ? (
                        <span
                          className={`shrink-0 text-xs ${
                            t.reasonableHour ? "text-slate-500" : "text-review"
                          }`}
                          title={t.reasonableHour ? undefined : "Outside working hours there"}
                        >
                          {t.label} their time
                        </span>
                      ) : (
                        /*
                          * slate-500, not slate-400. The lighter one measured
                          * 2.25:1 against the surface, well under the 4.5:1 a
                          * 12px string needs, and "we do not know the hour
                          * there" is exactly the kind of caveat that must not
                          * be the hardest thing on the row to read.
                          */
                        <span className="shrink-0 text-xs text-slate-500" title={t.note ?? undefined}>
                          Time there unknown
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {[c.trade, c.opportunityTitle].filter(Boolean).join(" · ")}
                    </p>

                    {/*
                      * Why we are calling, unless the attempt limit has
                      * already answered that. Both lines describe the same
                      * unanswered attempts, and printing them together read as
                      * a stutter: "called 5 times already", then "called 5
                      * times, which is the limit".
                      */}
                    {call.state !== "attempts_spent" && (
                      <p className="mt-1 text-xs text-slate-500">{callReason(c, now)}</p>
                    )}

                    {/*
                      * A card the rules say not to ring right now stays in the
                      * list and says why. Hiding it would leave an operator
                      * wondering where the work went, and the rule that
                      * produced the silence is the one thing they would need
                      * in order to change it.
                      */}
                    {!call.callable && (
                      <p className="mt-1 text-xs text-review">{call.reason}</p>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      <span
                        className={
                          quality === "no_phone" ? "text-risk" : quality === "phone_only" ? "text-review" : undefined
                        }
                      >
                        {CONTACT_QUALITY_LABEL[quality]}
                      </span>
                      {/*
                        When it would be reasonable to ring them, said as an
                        instruction rather than as a clock. At nine in the
                        morning with forty cards the question is which of these
                        can be done now, and the hour there is only half an
                        answer to it.
                      */}
                      <span className={window_.open === false ? "text-review" : undefined}>
                        {window_.label}
                      </span>
                      {/*
                        How many times this has already been dialled with
                        nobody picking up. Zero says so rather than rendering
                        blank: never tried and tried four times are the two
                        ends of the same column.
                      */}
                      <span className={c.attempts >= 3 ? "text-review" : undefined}>
                        {c.attempts === 0
                          ? "Not dialled yet"
                          : `${c.attempts} ${c.attempts === 1 ? "try" : "tries"}, no answer`}
                      </span>
                      <span>
                        {c.lastContacted
                          ? `Last wrote ${shortDate(c.lastContacted)}`
                          : "Never written to"}
                      </span>
                      {/*
                        The date their price is actually needed, which is not
                        the date the bid is due: the gap is the time it takes
                        to review the number, chase a replacement and assemble
                        the package. Working to the bid date is how a bid gets
                        assembled the night before with one trade missing.
                      */}
                      {c.quoteDueLabel && (
                        <span className={c.quoteDueOverdue ? "text-risk" : undefined}>
                          Quote due {c.quoteDueLabel}
                        </span>
                      )}
                      {c.deadline && (
                        <span className={countdown(c.deadline) === "overdue" ? "text-risk" : undefined}>
                          Bid due {countdown(c.deadline)}
                        </span>
                      )}
                    </div>
                  </Link>
                  {/*
                    The controls sit under the link rather than inside it: a
                    card is a link to the guided workspace, and a button
                    nested in one navigates as well as acting. Beside it they
                    need no click-swallowing wrapper, and must not have one:
                    "Start the call" is itself a link, and a wrapper that
                    cancels default behaviour would stop it opening.
                  */}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <Link
                      href={`${peekBase}${encodeURIComponent(
                        quickViewValue({ kind: "call_card", id: c.id })
                      )}`}
                      scroll={false}
                      className="tap text-xs text-slate-500 underline-offset-2 hover:text-accent"
                    >
                      Quick look
                    </Link>
                    <RowActions
                      actions={callCardRowActions(
                        {
                          id: c.id,
                          companyName: c.companyName,
                          trade: c.trade,
                          subcontractorId: c.subcontractorId ?? null,
                          opportunityId: c.opportunityId,
                          openHref: `${hrefBase}${c.id}`,
                        },
                        { role }
                      )}
                      recordLabel={c.companyName}
                      compact
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
