import Link from "next/link";
import { reviewQueue } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { BulkReviewList } from "@/components/bulk-review-list";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const opps = await reviewQueue();

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["review"]}
        title="Review"
        status={
          opps.length === 0
            ? "Nothing waiting"
            : `${opps.length} opportunit${opps.length === 1 ? "y" : "ies"} need a decision`
        }
        subtitle="Borderline scores (50-69). Select several to pursue, pass, or snooze together, or open a brief for full context."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-4" data-guide-target="review-list">
        {opps.length === 0 ? (
          <EmptyState
            tone="success"
            title="No decisions waiting"
            description="Borderline opportunities will appear here for a quick pursue or pass decision."
            action={
              <Link href="/today" className="btn-ghost text-sm">
                Back to Today
              </Link>
            }
          />
        ) : (
          <BulkReviewList opps={opps} />
        )}
      </div>
    </div>
  );
}
