import Link from "next/link";
import { callQueue } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { BulkCallQueue } from "@/components/bulk-call-queue";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function CallQueuePage({
  searchParams,
}: {
  searchParams?: { open?: string };
}) {
  const cards = await callQueue();
  // Deep link support: /call-queue?open=<cardId> opens that card's workspace
  // immediately (used by the Today page so one click lands in the call).
  const openId = searchParams?.open;

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["call-queue"]}
        title="Call Queue"
        status={
          cards.length === 0
            ? "No calls waiting"
            : `${cards.length} call${cards.length === 1 ? "" : "s"} ready`
        }
        subtitle="Soonest deadline first. Select several to skip or snooze together, or open a card to start the guided call."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5" data-guide-target="call-queue">
        {cards.length === 0 ? (
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
