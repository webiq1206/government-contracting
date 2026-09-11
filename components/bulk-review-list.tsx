"use client";

import type { Opportunity } from "@/lib/types";
import { ScoreBadge, TierBadge } from "@/components/badges";
import { RowActions } from "@/components/row-actions";
import { opportunityRowActions } from "@/lib/domain/row-actions";
import { countdown } from "@/lib/format";
import { flagLabel } from "@/lib/flag-labels";
import { EstimatedValue } from "@/components/estimated-value";
import { InfoTip } from "@/components/info-tip";
import { quickViewValue } from "@/lib/domain/quick-view";
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
  role,
  peekHref,
}: {
  o: Opportunity;
  href: string;
  selected: boolean;
  role?: string | null;
  peekHref: string;
}) {
  const dims = o.score_breakdown?.dimensions ?? [];
  const expiry = countdown(o.review_expires_at);
  const risks = o.risk_flags ?? [];
  const weakDims = dims.filter(
    (dimension) => dimension.max_points > 0 && dimension.points / dimension.max_points < 0.5
  );
  const primaryReason = risks[0]
    ? flagLabel(risks[0])
    : weakDims[0]
      ? `Weak: ${weakDims[0].label}`
      : null;
  const additionalDetails = Math.max(0, risks.length + weakDims.length - (primaryReason ? 1 : 0));

  return (
    <div
      className={`rounded-xl bg-surface p-4 transition-colors ${
        selected ? "ring-2 ring-accent/50" : "hover:bg-surface-raised"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <BulkSelectCheckbox id={o.id} label={`Select ${o.title ?? "opportunity"}`} />
        </div>
        <a
          href={href}
          aria-current={selected ? "true" : undefined}
          className="block min-w-0 flex-1"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-base font-medium leading-snug text-foreground">
                {o.title ?? "Untitled"}
              </p>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {o.agency ?? "Agency not stated"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {o.score != null && <ScoreBadge score={o.score} />}
              <TierBadge tier={o.tier} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span className={countdown(o.deadline) === "overdue" ? "font-medium text-risk" : "text-foreground"}>
              {countdown(o.deadline)}
            </span>
            {o.review_expires_at && (
              <span className="text-review">Decide in {expiry}</span>
            )}
          </div>

          {primaryReason && (
            <p className="mt-2 text-sm text-muted-foreground">
              {primaryReason}
              {additionalDetails > 0 ? ` · ${additionalDetails} more detail${additionalDetails === 1 ? "" : "s"}` : ""}
            </p>
          )}
        </a>
      </div>

      <details className="mt-3 border-t border-border/50 pt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted-foreground hover:text-accent">
          Details
        </summary>
        <div className="space-y-3 pb-2 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt className="text-xs text-muted-foreground">Estimated value</dt>
              <dd className="mt-0.5 text-foreground">
                <EstimatedValue value={o.value_estimated} source={o.value_estimated_source} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Past performance</dt>
              <dd className="mt-0.5 text-foreground">
                {o.past_perf_classification
                  ? (PAST_PERF_LABEL[o.past_perf_classification] ?? o.past_perf_classification)
                  : "Not assessed"}
              </dd>
            </div>
          </dl>

          {risks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Risks</p>
              <ul className="mt-1 space-y-1 text-sm text-foreground">
                {risks.map((risk, index) => <li key={`${risk}-${index}`}>· {flagLabel(risk)}</li>)}
              </ul>
            </div>
          )}

          {dims.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Score factors</p>
              <ul className="mt-1.5 space-y-1.5">
                {dims.map((dimension) => (
                  <li key={dimension.key} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1 text-foreground">
                      <span className="truncate">{dimension.label}</span>
                      {dimension.reasoning ? (
                        <InfoTip label={`Why: ${dimension.label}`} side="bottom">
                          {dimension.reasoning}
                        </InfoTip>
                      ) : null}
                    </span>
                    <span className="num shrink-0 text-muted-foreground">
                      {dimension.points}/{dimension.max_points}
                    </span>
                  </li>
                ))}
              </ul>
              {o.score_breakdown?.summary && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {o.score_breakdown.summary}
                </p>
              )}
            </div>
          )}
        </div>
      </details>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <a href={href} className="inline-flex min-h-11 items-center text-sm font-medium text-accent">
            Open brief
          </a>
          <a href={peekHref} className="tap text-sm text-muted-foreground hover:text-accent">
            Quick look
          </a>
        </div>
        <RowActions
          actions={opportunityRowActions(
            {
              id: o.id,
              title: o.title,
              stage: o.stage,
              status: o.status,
              snoozedUntil: o.snoozed_until ?? null,
              pursuitState: o.pursuit_state ?? null,
            },
            { role }
          )}
          recordLabel={o.title ?? "this opportunity"}
        />
      </div>
    </div>
  );
}

export function BulkReviewList({
  opps,
  selectedId = null,
  hrefBase,
  peekHrefBase,
  role,
}: {
  opps: Opportunity[];
  selectedId?: string | null;
  role?: string | null;
  hrefBase?: string;
  peekHrefBase: string;
}) {
  const ids = opps.map((o) => o.id);
  return (
    <BulkSelectionProvider ids={ids}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <BulkSelectAllCheckbox label={`Select all ${opps.length}`} />
          <p className="hidden text-xs text-muted-foreground sm:block">
            Select several to act together
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {opps.map((o) => (
            <ReviewCard
              key={o.id}
              o={o}
              href={hrefBase ? `${hrefBase}${o.id}` : `/opportunity/${o.id}`}
              selected={String(o.id) === selectedId}
              role={role}
              peekHref={`${peekHrefBase}${encodeURIComponent(
                quickViewValue({ kind: "opportunity", id: String(o.id) })
              )}`}
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
