import Link from "next/link";
import { NextResponse } from "next/server";
import { reviewQueue } from "@/lib/data";
import { PageFrame } from "@/components/page-frame";
import { PAGE_HELP } from "@/lib/help-content";
import { BulkReviewList } from "@/components/bulk-review-list";
import { ReviewBriefPanel } from "@/components/review-brief";
import { EmptyState } from "@/components/empty-state";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { buildReviewBrief } from "@/lib/domain/review-brief";
import { countdown } from "@/lib/format";
import type { Opportunity, SolicitationAnalysis } from "@/lib/types";
import type { DataConfidence } from "@/lib/domain/score-confidence";

export const dynamic = "force-dynamic";

/** ISO or null, never a Date pretending to be a string. */
function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const canDecide = can(ctx.user.orgRole, "decide");

  const opps = await reviewQueue();

  const rawSelected = searchParams?.o;
  const selectedId = (Array.isArray(rawSelected) ? rawSelected[0] : rawSelected) ?? null;
  /*
   * Default to the first in the queue rather than to nothing. The queue is
   * already ordered by how soon each one is dismissed automatically, so the
   * first is the one to decide, and an empty right-hand panel on a page whose
   * job is deciding is a page asking to be clicked before it does anything.
   */
  const selected: Opportunity | null =
    (selectedId ? opps.find((o) => String(o.id) === selectedId) : undefined) ?? opps[0] ?? null;

  const brief = selected
    ? buildReviewBrief({
        score: selected.score ?? null,
        dimensions: selected.score_breakdown?.dimensions ?? [],
        riskFlags: selected.risk_flags ?? [],
        /*
         * On the score breakdown, not on the analysis. It describes how much
         * of the notice could be read at scoring time, which is a property of
         * the scoring rather than of the solicitation.
         */
        confidence: (selected.score_breakdown?.data_confidence as DataConfidence | undefined) ?? null,
        deadline: iso(selected.deadline),
        reviewExpiresAt: iso(selected.review_expires_at),
        requiredTradeCount:
          (selected.solicitation_analysis as SolicitationAnalysis | null)?.required_trades?.length ??
          null,
        valueKnown: selected.value_estimated != null,
        pastPerfClassification: selected.past_perf_classification ?? null,
      })
    : null;

  const urgent = opps.filter((o) => {
    const c = countdown(o.review_expires_at);
    return c === "overdue" || /^(\d|1\d)h/.test(c);
  }).length;

  return (
    <div className="flex page-shell">
      <PageFrame
        help={PAGE_HELP["review"]}
        title="Review"
        status={
          opps.length === 0
            ? "Nothing waiting"
            : `${opps.length} to decide${urgent > 0 ? ` · ${urgent} dismissed within a day` : ""}`
        }
        explanation="Borderline scores. Read the case, then pursue or pass. Anything nobody decides is dismissed on its own timer."
      />

      {opps.length === 0 ? (
        <div className="scroll-thin flex-1 overflow-y-auto p-4">
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
        </div>
      ) : (
        /*
         * Two panels: the queue on the left, the case for the selected one on
         * the right. On a phone the brief takes the screen once something is
         * chosen, which is the same rule the conversation centre uses.
         */
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section
            aria-label="Decision queue"
            data-guide-target="review-list"
            className={`scroll-thin w-full shrink-0 overflow-y-auto border-r border-border/55 p-4 dark:border-white/10 lg:w-[420px] ${
              selectedId ? "hidden lg:block" : "block"
            }`}
          >
            <BulkReviewList
              opps={opps}
              selectedId={selected ? String(selected.id) : null}
              hrefBase="/review?o="
            />
          </section>

          <section
            aria-label="Decision brief"
            className={`min-w-0 flex-1 ${selectedId ? "flex flex-col" : "hidden lg:flex lg:flex-col"}`}
          >
            {selected && brief && (
              <ReviewBriefPanel
                opportunityId={String(selected.id)}
                title={selected.title ?? "Untitled opportunity"}
                subtitle={[selected.agency, selected.location_state, selected.set_aside_type]
                  .filter(Boolean)
                  .join(" · ")}
                brief={brief}
                canDecide={canDecide}
                closeHref="/review"
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
