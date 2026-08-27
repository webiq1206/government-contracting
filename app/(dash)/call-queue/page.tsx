import Link from "next/link";
import { callQueue } from "@/lib/data";
import { PageFrame } from "@/components/page-frame";
import { PAGE_HELP } from "@/lib/help-content";
import { areCallsEnabled, getAutomationRules } from "@/lib/app-settings";
import { EmptyState } from "@/components/empty-state";
import { buildCallQueueGuide } from "@/lib/domain/call-queue-guide";
import { GuidedPlanPanel } from "@/components/guided-plan";
import { CallQueueList } from "@/components/call-queue-list";
import { CallPanel } from "@/components/call-panel";
import { computeQuoteDeadline, resolveTimeZone } from "@/lib/domain/quote-deadline";
import { countdown } from "@/lib/format";
import {
  callQueueCounts,
  filterCalls,
  parseCallGrouping,
  CALL_GROUPINGS,
  CALL_GROUPING_LABEL,
  type CallCardFacts,
} from "@/lib/domain/call-queue";

export const dynamic = "force-dynamic";

export default async function CallQueuePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const [allCards, callsEnabled] = await Promise.all([callQueue(), areCallsEnabled()]);
  // Deep link support: /call-queue?open=<cardId> opens that card's workspace
  // immediately (used by the Today page so one click lands in the call).
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const openId = one(searchParams?.open);
  /**
   * /call-queue?opportunity=<id> narrows to one bid's calls. "Start calling"
   * on an opportunity used to drop the operator into the whole queue, where
   * finding the three subs for the job they were just looking at meant
   * reading every card. Scoped here, the page opens on exactly the trades
   * this bid needs priced.
   */
  const focusId = one(searchParams?.opportunity);
  const cards = focusId
    ? allCards.filter((c) => c.opportunity_id === focusId)
    : allCards;
  const focusTitle = focusId ? (cards[0]?.opportunity_title ?? null) : null;

  /*
   * The facts the queue rows and the header counts are computed from. Built
   * once here rather than inside the row, so the count at the top and the row
   * underneath it cannot disagree about whether it is a reasonable hour where
   * somebody is.
   */
  const now = new Date();
  const q = one(searchParams?.q)?.trim() ?? "";
  const grouping = parseCallGrouping(searchParams?.group);
  const facts: CallCardFacts[] = cards.map((c) => ({
    id: c.id,
    companyName: c.company_name,
    trade: c.trade ?? null,
    opportunityId: c.opportunity_id ?? null,
    opportunityTitle: c.opportunity_title ?? null,
    deadline: c.deadline ? new Date(c.deadline as unknown as string).toISOString() : null,
    source: c.source ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    emailVerified: Boolean(c.email_verified),
    state: c.state ?? null,
    lastContacted: c.last_contacted ?? null,
    attempts: Number(c.attempts ?? 0),
    ...quoteDueFacts(c.deadline as unknown as string | null, c.state ?? null, now),
  }));
  // The calling window and attempt limit are operator rules now, so the queue
  // reads them rather than assuming 8 to 6 and no limit.
  const rules = await getAutomationRules();
  const counts = callQueueCounts(facts, now, rules);
  const shown = filterCalls(facts, q);

  function queueHref(over: { q?: string; group?: string; open?: string | null } = {}): string {
    const p = new URLSearchParams();
    if (focusId) p.set("opportunity", focusId);
    const nextQ = over.q ?? q;
    const nextGroup = over.group ?? grouping;
    if (nextQ) p.set("q", nextQ);
    if (nextGroup !== "none") p.set("group", nextGroup);
    const nextOpen = over.open === undefined ? openId : over.open;
    if (nextOpen) p.set("open", nextOpen);
    const str = p.toString();
    return str ? `/call-queue?${str}` : "/call-queue";
  }
  const openBase = (() => {
    const p = new URLSearchParams();
    if (focusId) p.set("opportunity", focusId);
    if (q) p.set("q", q);
    if (grouping !== "none") p.set("group", grouping);
    const str = p.toString();
    return str ? `/call-queue?${str}&open=` : "/call-queue?open=";
  })();
  // A filter that matches nothing must say so rather than look like an empty
  // queue: the calls may have been made already, or belong to another bid.
  const focusEmpty = Boolean(focusId) && cards.length === 0 && allCards.length > 0;

  return (
    <div className="flex page-shell">
      <PageFrame
        help={PAGE_HELP["call-queue"]}
        title="Call Queue"
        /*
         * A scoped queue is a place you can be, so it gets a trail back. The
         * only way out of "just this bid's calls" used to be the browser's
         * Back button or noticing a link in the header.
         */
        breadcrumbs={
          focusId
            ? [
                { label: "Call Queue", href: "/call-queue" },
                // The title comes from the first card, so a scoped queue with
                // no calls left has none. That is exactly when a way back
                // matters most, so the crumb is keyed off the scope itself.
                { label: focusTitle ?? "This opportunity" },
              ]
            : []
        }
        status={
          !callsEnabled
            ? "Calling is off"
            : cards.length === 0
              ? "No calls waiting"
              : [
                  `${counts.remaining} to make`,
                  counts.urgent > 0 ? `${counts.urgent} on a bid due inside two days` : null,
                  counts.badHour > 0 ? `${counts.badHour} outside your calling hours there` : null,
                  counts.attemptsSpent > 0
                    ? `${counts.attemptsSpent} past the attempt limit`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
        }
        explanation={
          !callsEnabled
            ? "This account runs on email only, so nothing is queued here and no opportunity is waiting on a call."
            : focusTitle
              ? `Just the subs for ${focusTitle}, one card per trade. Open a card to start the guided call.`
              : "Soonest deadline first. Select several to skip or snooze together, or open a card to start the guided call."
        }
        primaryAction={
          focusId ? (
            <Link href="/call-queue" className="btn-ghost text-xs">
              Show all calls ({allCards.length})
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!callsEnabled ? (
          <div className="scroll-thin flex-1 overflow-y-auto p-5">
          <EmptyState
            title="Calling is turned off"
            description="Outreach emails, 48-hour follow-ups, and automatic quote capture from replies all keep running; opportunities move straight from their outreach email to collecting quotes. Turn calling back on in Automation Rules to start preparing call cards again."
            action={
              <Link href="/settings/rules#calls" className="btn-ghost text-sm">
                Open call settings
              </Link>
            }
          />
          </div>
        ) : focusEmpty ? (
          <div className="scroll-thin flex-1 overflow-y-auto p-5">
          <EmptyState
            title="No calls waiting for this opportunity"
            description="Every prepared call for this bid has been made, skipped, or snoozed. Other opportunities still have calls in the queue."
            action={
              <Link href="/call-queue" className="btn-ghost text-sm">
                Show all calls ({allCards.length})
              </Link>
            }
          />
          </div>
        ) : cards.length === 0 ? (
          <div className="scroll-thin flex-1 overflow-y-auto p-5">
          <EmptyState
            title="No calls in the queue"
            description="A call card appears here for every sub we email, so you can follow up by phone. Subs who reply are marked and sorted to the top."
            action={
              <Link href="/today" className="btn-ghost text-sm">
                Back to Today
              </Link>
            }
          />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/*
              * A permanent split on a wide screen: the queue stays put and the
              * call changes beside it. An operator making eight calls in a
              * morning finishes one and starts the next, and a dialog that
              * closes and reopens between every pair puts a full-screen
              * transition in the middle of that rhythm.
              */}
            <section
              aria-label="Calls"
              data-guide-target="call-queue"
              className={`scroll-thin w-full shrink-0 space-y-4 overflow-y-auto border-r border-border/55 p-4 dark:border-white/10 lg:w-[400px] ${
                openId ? "hidden lg:block" : "block"
              }`}
            >
              {/*
                * The plan names the call to start with, so it only makes sense
                * over the unfiltered queue in its default order. Shown beside a
                * search result it would point at a card that is not on screen.
                */}
              {!openId && !q && grouping === "none" && (
                <GuidedPlanPanel
                  eyebrow="How calling works"
                  plan={buildCallQueueGuide({
                    first: {
                      id: cards[0].id,
                      companyName: cards[0].company_name,
                      trade: cards[0].trade ?? null,
                      fromReply: cards[0].source === "reply",
                    },
                    queueLength: cards.length,
                  })}
                />
              )}

              <form method="get" action="/call-queue" className="flex flex-wrap items-center gap-2">
                {focusId && <input type="hidden" name="opportunity" value={focusId} />}
                {grouping !== "none" && <input type="hidden" name="group" value={grouping} />}
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Company, trade or solicitation…"
                  aria-label="Search the call queue"
                  className="input w-full max-w-xs text-sm"
                />
                <button type="submit" className="btn-ghost text-sm">
                  Search
                </button>
                {q && (
                  <Link href={queueHref({ q: "", open: null })} className="tap text-xs text-slate-500 hover:text-accent">
                    Clear
                  </Link>
                )}
              </form>

              <nav aria-label="Group the queue" className="flex flex-wrap gap-2">
                {CALL_GROUPINGS.map((g) => (
                  <Link
                    key={g}
                    href={queueHref({ group: g })}
                    aria-current={g === grouping ? "page" : undefined}
                    className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
                      g === grouping
                        ? "border-gold bg-gold/15 text-foreground"
                        : "border-border text-foreground hover:border-foreground/30"
                    }`}
                  >
                    {CALL_GROUPING_LABEL[g]}
                  </Link>
                ))}
              </nav>

              {shown.length === 0 ? (
                <EmptyState
                  tone="success"
                  title="No calls match that search"
                  description="Try a company name, a trade, or the solicitation title."
                  action={
                    <Link href={queueHref({ q: "", open: null })} className="btn-ghost text-sm">
                      Show every call
                    </Link>
                  }
                />
              ) : (
                <CallQueueList
                  cards={shown}
                  grouping={grouping}
                  selectedId={openId ?? null}
                  hrefBase={openBase}
                  now={now}
          rules={rules}
                />
              )}
            </section>

            <section
              aria-label="Active call"
              className={`min-w-0 flex-1 ${openId ? "flex flex-col" : "hidden lg:flex lg:flex-col"}`}
            >
              {openId ? (
                <CallPanel cardId={openId} closeHref={queueHref({ open: null })} />
              ) : (
                <div className="flex flex-1 items-center justify-center p-8">
                  <p className="max-w-sm text-center text-sm text-slate-500">
                    Pick a call to open the guided workspace. The queue is in
                    deadline order with anyone who has already written back on top.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * When this sub's price is actually needed, in their words and their zone.
 *
 * Computed here rather than in the row so every card on the page reads the
 * same clock, and through the one function that already knows how to work
 * back from a bid deadline: a second derivation would eventually promise a
 * subcontractor a date the outreach email does not.
 *
 * Both silences are deliberate. No bid deadline means there is nothing to work
 * back from, and too little time left means no split of it gives the sub long
 * enough to price, so there is no honest date to show.
 */
function quoteDueFacts(
  deadline: string | null,
  state: string | null,
  now: Date
): { quoteDueLabel: string | null; quoteDueOverdue: boolean } {
  /*
   * The subcontractor's own state is the sender's here: they are the one
   * being given a deadline, and a date spoken in the wrong zone is a date
   * somebody misses by a working day.
   */
  const zone = resolveTimeZone({ senderState: state });
  const due = computeQuoteDeadline({ deadline, timeZone: zone.timeZone, now });
  if (!due.at) return { quoteDueLabel: null, quoteDueOverdue: false };
  return {
    quoteDueLabel: countdown(due.at),
    quoteDueOverdue: new Date(due.at).getTime() < now.getTime(),
  };
}
