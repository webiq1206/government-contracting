import Link from "next/link";
import { reviewQueue } from "@/lib/data";
import { PageHeader, ScoreBadge, TierBadge } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { ActionButton } from "@/components/action-button";
import { currency, countdown } from "@/lib/format";
import { flagLabel } from "@/lib/flag-labels";
import { EstimatedValue } from "@/components/estimated-value";
import type { Opportunity } from "@/lib/types";
import { StopClickPropagation } from "@/components/stop-click-propagation";

export const dynamic = "force-dynamic";

const PAST_PERF_LABEL: Record<string, string> = {
  not_required: "Not required",
  team_accepted: "Team experience counts",
  prime_only: "Must be our own (blocked)",
};

function DimensionBar({
  label,
  points,
  max,
}: {
  label: string;
  points: number;
  max: number;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, points / max)) : 0;
  const color =
    ratio >= 0.75 ? "bg-pursue" : ratio >= 0.4 ? "bg-review" : "bg-risk";
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="num text-slate-700">
          {points}/{max}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function ReviewCard({ o }: { o: Opportunity }) {
  const dims = o.score_breakdown?.dimensions ?? [];
  const expiry = countdown(o.review_expires_at);
  return (
    <Link
      href={`/opportunity/${o.id}`}
      className="card block space-y-4 border-border hover:border-accent/60 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {o.title ?? "Untitled"}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {o.agency ?? "-"}
            {o.location_state ? ` · ${o.location_state}` : ""}
            {o.naics_code ? ` · industry code (NAICS) ${o.naics_code}` : ""}
            {o.set_aside_type ? ` · ${o.set_aside_type}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ScoreBadge score={o.score} />
          <TierBadge tier={o.tier} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <p className="label">Est. value</p>
          <p className="mt-0.5 text-sm font-medium text-slate-900">
            <EstimatedValue value={o.value_estimated} source={o.value_estimated_source} />
          </p>
        </div>
        <div>
          <p className="label">Deadline</p>
          <p
            className={`mt-0.5 text-sm font-medium ${
              expiry === "overdue" ? "text-risk" : "text-slate-900"
            }`}
          >
            ⏱ {countdown(o.deadline)}
          </p>
        </div>
        <div>
          <p
            className="label"
            title="Past performance: proof of similar completed work. Some agencies accept your subs' experience; some require your company's own."
          >
            Past performance
          </p>
          <p className="mt-0.5 text-sm text-slate-900">
            {o.past_perf_classification
              ? (PAST_PERF_LABEL[o.past_perf_classification] ??
                o.past_perf_classification)
              : "-"}
          </p>
        </div>
        <div>
          <p className="label">Auto-dismiss</p>
          <p
            className={`mt-0.5 text-sm font-medium ${
              o.review_expires_at ? "text-review" : "text-slate-500"
            }`}
          >
            {o.review_expires_at ? `in ${expiry}` : "-"}
          </p>
        </div>
      </div>

      {dims.length > 0 && (
        <div className="space-y-2">
          <p className="label">Score breakdown</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {dims.map((d) => (
              <DimensionBar
                key={d.key}
                label={d.label}
                points={d.points}
                max={d.max_points}
              />
            ))}
          </div>
          {o.score_breakdown?.summary && (
            <p className="text-xs text-slate-600">{o.score_breakdown.summary}</p>
          )}
        </div>
      )}

      {o.risk_flags && o.risk_flags.length > 0 && (
        <div>
          <p className="label">Key risk factors</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Reasons this needs your judgment. Open the card to decide whether
            your team can work around them.
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {o.risk_flags.map((f, i) => (
              <span key={i} className="badge bg-risk/15 text-risk">
                ⚠ {flagLabel(f)}
              </span>
            ))}
          </div>
        </div>
      )}

      <StopClickPropagation className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-slate-500">
          Click the card to open the full record →
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
    <div className="flex h-screen flex-col">
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
