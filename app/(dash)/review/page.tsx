import Link from "next/link";
import { reviewQueue } from "@/lib/data";
import { PageHeader, ScoreBadge, TierBadge } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { currency, countdown } from "@/lib/format";
import type { Opportunity } from "@/lib/types";
import { StopClickPropagation } from "@/components/stop-click-propagation";

export const dynamic = "force-dynamic";

const PAST_PERF_LABEL: Record<string, string> = {
  not_required: "Past perf not required",
  team_accepted: "Team past perf accepted",
  prime_only: "Prime past perf only",
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
        <span className="text-slate-400">{label}</span>
        <span className="num text-slate-300">
          {points}/{max}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
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
          <p className="text-sm font-medium text-slate-100">
            {o.title ?? "Untitled"}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {o.agency ?? "—"}
            {o.location_state ? ` · ${o.location_state}` : ""}
            {o.naics_code ? ` · NAICS ${o.naics_code}` : ""}
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
          <p className="mt-0.5 text-sm font-medium text-slate-100">
            {currency(o.value_estimated)}
          </p>
        </div>
        <div>
          <p className="label">Deadline</p>
          <p
            className={`mt-0.5 text-sm font-medium ${
              expiry === "overdue" ? "text-risk" : "text-slate-100"
            }`}
          >
            ⏱ {countdown(o.deadline)}
          </p>
        </div>
        <div>
          <p className="label">Past perf</p>
          <p className="mt-0.5 text-sm text-slate-100">
            {o.past_perf_classification
              ? (PAST_PERF_LABEL[o.past_perf_classification] ??
                o.past_perf_classification)
              : "—"}
          </p>
        </div>
        <div>
          <p className="label">Auto-dismiss</p>
          <p
            className={`mt-0.5 text-sm font-medium ${
              o.review_expires_at ? "text-review" : "text-slate-500"
            }`}
          >
            {o.review_expires_at ? `in ${expiry}` : "—"}
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
            <p className="text-xs text-slate-400">{o.score_breakdown.summary}</p>
          )}
        </div>
      )}

      {o.risk_flags && o.risk_flags.length > 0 && (
        <div>
          <p className="label">Key risk factors</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {o.risk_flags.map((f, i) => (
              <span key={i} className="badge bg-risk/15 text-risk">
                ⚠ {f}
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
          >
            Pursue
          </ActionButton>
          <ActionButton
            endpoint={`/api/opportunities/${o.id}/action`}
            body={{ action: "dismiss" }}
            className="btn-danger"
            confirm="Dismiss this opportunity?"
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
        title="Review Queue"
        subtitle={`${opps.length} opportunit${opps.length === 1 ? "y" : "ies"} awaiting triage (scored 50–69).`}
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {opps.length === 0 ? (
          <div className="card mx-auto mt-8 max-w-md text-center">
            <p className="text-2xl">✅</p>
            <p className="mt-2 text-sm font-medium text-slate-200">
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
