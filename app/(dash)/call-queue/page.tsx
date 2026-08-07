import { callQueue } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { CallCard } from "@/components/call-card";

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
    <div className="flex h-screen flex-col">
      <PageHeader
        help={PAGE_HELP["call-queue"]}
        title="Call Queue"
        subtitle={`${cards.length} call${cards.length === 1 ? "" : "s"} to make · soonest deadline first`}
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        {cards.length === 0 ? (
          <div className="card mx-auto mt-8 max-w-md text-center">
            <p className="text-3xl">📞</p>
            <p className="mt-3 text-base font-semibold text-foreground">
              No calls in the queue.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              A call card appears here for every sub we email, so you can follow
              up by phone. Subs who reply are marked and sorted to the top.
            </p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2">
            {cards.map((c) => (
              <CallCard key={c.id} c={c} autoOpen={c.id === openId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
