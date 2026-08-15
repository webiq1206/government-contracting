import Link from "next/link";
import { callQueue } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { areCallsEnabled } from "@/lib/app-settings";
import { BulkCallQueue } from "@/components/bulk-call-queue";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function CallQueuePage({
  searchParams,
}: {
  searchParams?: { open?: string };
}) {
  const [cards, callsEnabled] = await Promise.all([callQueue(), areCallsEnabled()]);
  // Deep link support: /call-queue?open=<cardId> opens that card's workspace
  // immediately (used by the Today page so one click lands in the call).
  const openId = searchParams?.open;

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
          callsEnabled
            ? "Soonest deadline first. Select several to skip or snooze together, or open a card to start the guided call."
            : "This account runs on email only, so nothing is queued here and no opportunity is waiting on a call."
        }
      />
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
          <BulkCallQueue cards={cards} openId={openId} />
        )}
      </div>
    </div>
  );
}
