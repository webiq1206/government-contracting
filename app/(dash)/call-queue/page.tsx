import Link from "next/link";
import { callQueue } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { areCallsEnabled } from "@/lib/app-settings";
import { BulkCallQueue } from "@/components/bulk-call-queue";
import { EmptyState } from "@/components/empty-state";
import { buildCallQueueGuide } from "@/lib/domain/call-queue-guide";
import { GuidedPlanPanel } from "@/components/guided-plan";

export const dynamic = "force-dynamic";

export default async function CallQueuePage({
  searchParams,
}: {
  searchParams?: { open?: string; opportunity?: string };
}) {
  const [allCards, callsEnabled] = await Promise.all([callQueue(), areCallsEnabled()]);
  // Deep link support: /call-queue?open=<cardId> opens that card's workspace
  // immediately (used by the Today page so one click lands in the call).
  const openId = searchParams?.open;
  /**
   * /call-queue?opportunity=<id> narrows to one bid's calls. "Start calling"
   * on an opportunity used to drop the operator into the whole queue, where
   * finding the three subs for the job they were just looking at meant
   * reading every card. Scoped here, the page opens on exactly the trades
   * this bid needs priced.
   */
  const focusId = searchParams?.opportunity;
  const cards = focusId
    ? allCards.filter((c) => c.opportunity_id === focusId)
    : allCards;
  const focusTitle = focusId ? (cards[0]?.opportunity_title ?? null) : null;
  // A filter that matches nothing must say so rather than look like an empty
  // queue: the calls may have been made already, or belong to another bid.
  const focusEmpty = Boolean(focusId) && cards.length === 0 && allCards.length > 0;

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["call-queue"]}
        title="Call Queue"
        status={
          !callsEnabled
            ? "Calling is off"
            : cards.length === 0
              ? "No calls waiting"
              : `${cards.length} call${cards.length === 1 ? "" : "s"} ready`
        }
        subtitle={
          !callsEnabled
            ? "This account runs on email only, so nothing is queued here and no opportunity is waiting on a call."
            : focusTitle
              ? `Just the subs for ${focusTitle}, one card per trade. Open a card to start the guided call.`
              : "Soonest deadline first. Select several to skip or snooze together, or open a card to start the guided call."
        }
      >
        {focusId && (
          <Link href="/call-queue" className="btn-ghost text-xs">
            Show all calls ({allCards.length})
          </Link>
        )}
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto p-5" data-guide-target="call-queue">
        {!callsEnabled ? (
          <EmptyState
            title="Calling is turned off"
            description="Outreach emails, 48-hour follow-ups, and automatic quote capture from replies all keep running; opportunities move straight from their outreach email to collecting quotes. Turn calling back on in Automation Rules to start preparing call cards again."
            action={
              <Link href="/settings/rules#calls" className="btn-ghost text-sm">
                Open call settings
              </Link>
            }
          />
        ) : focusEmpty ? (
          <EmptyState
            title="No calls waiting for this opportunity"
            description="Every prepared call for this bid has been made, skipped, or snoozed. Other opportunities still have calls in the queue."
            action={
              <Link href="/call-queue" className="btn-ghost text-sm">
                Show all calls ({allCards.length})
              </Link>
            }
          />
        ) : cards.length === 0 ? (
          <EmptyState
            title="No calls in the queue"
            description="A call card appears here for every sub we email, so you can follow up by phone. Subs who reply are marked and sorted to the top."
            action={
              <Link href="/today" className="btn-ghost text-sm">
                Back to Today
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {/* Which call to make first and what opening it does, before the
                list asks anyone to choose. Hidden when a card is already open
                via deep link; the workspace is the guide from there. */}
            {!openId && (
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
            <BulkCallQueue cards={cards} openId={openId} />
          </div>
        )}
      </div>
    </div>
  );
}
