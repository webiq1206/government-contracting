import Link from "next/link";
import {
  callReason,
  contactQuality,
  localTimeFor,
  callability,
  groupCalls,
  CONTACT_QUALITY_LABEL,
  type CallCardFacts,
  type CallGrouping,
  type CallRules,
} from "@/lib/domain/call-queue";
import { shortDate, countdown } from "@/lib/format";

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
  now,
  rules,
}: {
  cards: CallCardFacts[];
  grouping: CallGrouping;
  selectedId: string | null;
  /** Prefix for a row's link, with the id appended. */
  hrefBase: string;
  now: Date;
  /** The operator's calling window and attempt limit, from Automation Rules. */
  rules: CallRules;
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
                      <span>
                        {c.lastContacted
                          ? `Last wrote ${shortDate(c.lastContacted)}`
                          : "Never written to"}
                      </span>
                      {c.deadline && (
                        <span className={countdown(c.deadline) === "overdue" ? "text-risk" : undefined}>
                          Bid due {countdown(c.deadline)}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
