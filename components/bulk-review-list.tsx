"use client";

import Link from "next/link";
import type { Opportunity } from "@/lib/types";
import { ScoreBadge, TierBadge } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { countdown } from "@/lib/format";
import { flagLabel } from "@/lib/flag-labels";
import { EstimatedValue } from "@/components/estimated-value";
import { InfoTip } from "@/components/info-tip";
import { StopClickPropagation } from "@/components/stop-click-propagation";
import {
  BulkActionBar,
  BulkSelectAllCheckbox,
  BulkSelectCheckbox,
  BulkSelectionProvider,
} from "@/components/bulk-selection";

const PAST_PERF_LABEL: Record<string, string> = {
  not_required: "Not required",
  team_accepted: "Team experience counts",
  prime_only: "Must be our own (blocked)",
};

function ReviewCard({
  o,
  href,
  selected,
}: {
  o: Opportunity;
  href: string;
  selected: boolean;
}) {
  const dims = o.score_breakdown?.dimensions ?? [];
  const expiry = countdown(o.review_expires_at);
  const topRisks = (o.risk_flags ?? []).slice(0, 3);
  const moreRisks = (o.risk_flags?.length ?? 0) - topRisks.length;
  const weakDims = dims
    .filter((d) => d.max_points > 0 && d.points / d.max_points < 0.5)
    .slice(0, 2);

  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      /*
       * Selects the brief beside it rather than jumping to the record. The
       * record is one click further on, from the brief, which is where
       * somebody goes when the brief did not settle it.
       */
      className={`card block space-y-3 transition-all hover:border-accent/60 hover:shadow-md ${
        selected ? "border-gold bg-gold/[0.06]" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <StopClickPropagation className="pt-1">
            <BulkSelectCheckbox id={o.id} label={`Select ${o.title ?? "opportunity"}`} />
          </StopClickPropagation>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">{o.title ?? "Untitled"}</p>
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
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ScoreBadge score={o.score} />
          <TierBadge tier={o.tier} />
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
          <p className="label">Past performance</p>
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

      <StopClickPropagation className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs font-medium text-accent-strong">Open brief</span>
        <div className="flex gap-2">
          <ActionButton
            endpoint={`/api/opportunities/${o.id}/action`}
            body={{ action: "pursue" }}
            className="btn-success"
            toast={{ message: "Pursued. Analysis and pricing are running." }}
          >
            Pursue opportunity
          </ActionButton>
          {/*
            * The per-card Pass is gone. It passed with no reason, which is the
            * thing the audit asked to stop, and the brief beside this card now
            * carries Pass with the reason box attached. Two controls for one
            * decision, one of which skipped the requirement, is worse than one
            * that asks.
            */}
        </div>
      </StopClickPropagation>
    </Link>
  );
}

export function BulkReviewList({
  opps,
  selectedId = null,
  hrefBase,
}: {
  opps: Opportunity[];
  selectedId?: string | null;
  /**
   * Prefix for a card's link, with the id appended. A string rather than a
   * function because this is a client component and a function prop cannot
   * cross that boundary -- TypeScript accepts it and the render throws, which
   * is how this was found. Absent, cards go to the record, so the component
   * still works anywhere it is used outside the two-panel Review page.
   */
  hrefBase?: string;
}) {
  const ids = opps.map((o) => o.id);
  return (
    <BulkSelectionProvider ids={ids}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <BulkSelectAllCheckbox label={`Select all ${opps.length}`} />
          <p className="text-xs text-muted-foreground">
            Select to pursue, pass, or snooze together
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4">
          {opps.map((o) => (
            <ReviewCard
              key={o.id}
              o={o}
              href={hrefBase ? `${hrefBase}${o.id}` : `/opportunity/${o.id}`}
              selected={String(o.id) === selectedId}
            />
          ))}
        </div>
      </div>
      <BulkActionBar
        noun="opportunity"
        actions={[
          { kind: "pursue", label: "Pursue" },
          {
            kind: "dismiss",
            label: "Pass",
            confirm:
              "Passing on the selected opportunities. Why? One line is enough, and it is what the scoring learns from.",
          },
          { kind: "snooze_opps" },
        ]}
      />
    </BulkSelectionProvider>
  );
}
