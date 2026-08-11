import Link from "next/link";
import { reviewQueue } from "@/lib/data";
import { PageHeader, ScoreBadge, TierBadge } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { ActionButton } from "@/components/action-button";
import { countdown } from "@/lib/format";
import { flagLabel } from "@/lib/flag-labels";
import { EstimatedValue } from "@/components/estimated-value";
import { InfoTip } from "@/components/info-tip";
import { termTip } from "@/lib/domain/glossary";
import type { Opportunity } from "@/lib/types";
import { StopClickPropagation } from "@/components/stop-click-propagation";

export const dynamic = "force-dynamic";

const PAST_PERF_LABEL: Record<string, string> = {
  not_required: "Not required",
  team_accepted: "Team experience counts",
  prime_only: "Must be our own (blocked)",
};

/**
 * Scan-first review card: score, deadline, value, top risks, Pursue/Dismiss.
 * Full score bars stay one click away so the queue isn't a metadata wall.
 */
function ReviewCard({ o }: { o: Opportunity }) {
  const dims = o.score_breakdown?.dimensions ?? [];
  const expiry = countdown(o.review_expires_at);
  const topRisks = (o.risk_flags ?? []).slice(0, 3);
  const moreRisks = (o.risk_flags?.length ?? 0) - topRisks.length;
  const weakDims = dims
    .filter((d) => d.max_points > 0 && d.points / d.max_points < 0.5)
    .slice(0, 2);

  return (
    <Link
      href={`/opportunity/${o.id}`}
      className="card block space-y-3 border-border transition-all hover:border-accent/60 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {o.title ?? "Untitled"}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {[
              o.agency,
              o.location_state,
              o.set_aside_type,
              o.naics_code ? `NAICS ${o.naics_code}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1">
            <ScoreBadge score={o.score} />
            <StopClickPropagation className="inline-flex">
              <InfoTip label="What is the opportunity score?">{termTip("score")}</InfoTip>
            </StopClickPropagation>
          </span>
          <span className="inline-flex items-center gap-1">
            <TierBadge tier={o.tier} />
            <StopClickPropagation className="inline-flex">
              <InfoTip label="What does Review tier mean?">{termTip("tier_review")}</InfoTip>
            </StopClickPropagation>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <p className="label">Est. value</p>
          <p className="mt-0.5 text-sm font-medium text-slate-900">
            <EstimatedValue
              value={o.value_estimated}
              source={o.value_estimated_source}
            />
          </p>
        </div>
        <div>
          <p className="label">Deadline</p>
          <p
            className={`mt-0.5 text-sm font-medium ${
              countdown(o.deadline) === "overdue" ? "text-risk" : "text-slate-900"
            }`}
          >
            {countdown(o.deadline)}
          </p>
        </div>
        <div>
          <p className="label inline-flex items-center gap-1">
            Past performance
            <StopClickPropagation className="inline-flex">
              <InfoTip label="What is past performance?">
                {termTip("past_performance")}
              </InfoTip>
            </StopClickPropagation>
          </p>
          <p className="mt-0.5 text-sm text-slate-900">
            {o.past_perf_classification
              ? (PAST_PERF_LABEL[o.past_perf_classification] ??
                o.past_perf_classification)
              : "-"}
          </p>
        </div>
        <div>
          <p className="label">Decide by</p>
          <p
            className={`mt-0.5 text-sm font-medium ${
              o.review_expires_at ? "text-review" : "text-slate-500"
            }`}
          >
            {o.review_expires_at ? `auto-dismiss in ${expiry}` : "-"}
          </p>
        </div>
      </div>

      {(topRisks.length > 0 || weakDims.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {topRisks.map((f, i) => (
            <span key={i} className="badge bg-risk/15 text-risk">
              {flagLabel(f)}
            </span>
          ))}
          {moreRisks > 0 && (
            <span className="badge bg-slate-200 text-slate-600">+{moreRisks} more</span>
          )}
          {weakDims.map((d) => (
            <span key={d.key} className="badge bg-review/15 text-review">
              Weak: {d.label} ({d.points}/{d.max_points})
            </span>
          ))}
        </div>
      )}

      {dims.length > 0 && (
        <StopClickPropagation>
          <details className="rounded-md border border-border bg-surface/60 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-accent">
              Score factors ({dims.length}), open for full breakdown
            </summary>
            <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
              {dims.map((d) => (
                <li
                  key={d.key}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1 text-slate-700">
                    <span className="truncate">{d.label}</span>
                    {d.reasoning ? (
                      <InfoTip label={`Why: ${d.label}`} side="bottom">
                        {d.reasoning}
                      </InfoTip>
                    ) : null}
                  </span>
                  <span className="num shrink-0 text-slate-500">
                    {d.points}/{d.max_points}
                  </span>
                </li>
              ))}
            </ul>
            {o.score_breakdown?.summary && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                {o.score_breakdown.summary}
              </p>
            )}
          </details>
        </StopClickPropagation>
      )}

      <StopClickPropagation className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-slate-500">
          Open the brief for full context, or decide here →
        </span>
        <div className="flex gap-2">
          <ActionButton
            endpoint={`/api/opportunities/${o.id}/action`}
            body={{ action: "pursue" }}
            className="btn-success"
            toast={{ message: "Pursued. Analysis and pricing are running." }}
          >
            Pursue
          </ActionButton>
          <ActionButton
            endpoint={`/api/opportunities/${o.id}/action`}
            body={{ action: "dismiss" }}
            className="btn-danger"
            toast={{
              message: `Dismissed "${o.title ?? "opportunity"}". It's archived, not deleted.`,
              undo: {
                endpoint: `/api/opportunities/${o.id}/action`,
                body: { action: "restore" },
              },
            }}
          >
            Dismiss
          </ActionButton>
        </div>
      </StopClickPropagation>
    </Link>
  );
}

export default async function ReviewPage() {
  const opps = await reviewQueue();

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["review"]}
        title="Review Queue"
        subtitle={`${opps.length} opportunit${opps.length === 1 ? "y" : "ies"} awaiting triage (scored 50-69).`}
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {opps.length === 0 ? (
          <div className="card mx-auto mt-8 max-w-md text-center">
            <p className="text-2xl">✅</p>
            <p className="mt-2 text-sm font-medium text-slate-800">
              No items awaiting review.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Borderline opportunities will appear here for a quick pursue or
              dismiss decision.
            </p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4">
            {opps.map((o) => (
              <ReviewCard key={o.id} o={o} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
