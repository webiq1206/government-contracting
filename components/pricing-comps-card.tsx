import type { ReactNode } from "react";
import { Collapsible } from "@/components/collapsible";
import { InfoTip } from "@/components/info-tip";
import { currency } from "@/lib/format";
import {
  COMP_METRIC_TIPS,
  cpiTip,
  positionInCompBand,
  readCompBand,
  type CompPositionTone,
} from "@/lib/domain/pricing-comps-explain";
import { termTip } from "@/lib/domain/glossary";

const TONE_CLASS: Record<CompPositionTone, string> = {
  below_band: "bg-review/15 text-review",
  low: "bg-accent/15 text-accent-strong",
  typical: "bg-pursue/15 text-pursue",
  high: "bg-accent/15 text-accent-strong",
  above_band: "bg-risk/15 text-risk",
  unknown: "bg-slate-200 text-slate-600",
};

function MetricRow({
  label,
  tip,
  value,
}: {
  label: string;
  tip: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="inline-flex items-center gap-1 text-slate-500">
        {label}
        <InfoTip label={`About ${label}`}>{tip}</InfoTip>
      </span>
      <span className="num text-slate-800">{value}</span>
    </div>
  );
}

/**
 * Historical award comps with plain-English tips and a visual band so operators
 * can see how a quote, bid, or estimated value compares, not just raw numbers.
 */
export function PricingCompsCard({
  pricing,
  compareAmount,
  compareLabel,
}: {
  pricing: Record<string, unknown> | null | undefined;
  /** Optional amount to place on the band (lowest quote, bid, or est. value). */
  compareAmount?: number | null;
  compareLabel?: string | null;
}) {
  if (!pricing) return null;
  const band = readCompBand(pricing);
  const naics = typeof pricing.naics === "string" ? pricing.naics : null;
  const state = typeof pricing.state === "string" ? pricing.state : null;
  const year =
    typeof pricing.current_year === "number"
      ? pricing.current_year
      : Number(pricing.current_year) || null;
  const seriesId =
    typeof pricing.cpi_series_id === "string" ? pricing.cpi_series_id : null;
  const proxyNote =
    typeof pricing.sub_cost_proxy_note === "string"
      ? pricing.sub_cost_proxy_note
      : null;

  if (!band) {
    return (
      <Collapsible title="Pricing comps">
        <p className="text-sm text-slate-500">
          No comparable awards found for this NAICS and area yet. Brost Co looks
          at USASpending history for similar work; once comps exist, you will see
          a typical price band here.
        </p>
      </Collapsible>
    );
  }

  const position = positionInCompBand(compareAmount ?? null, band);
  const showMarker = position.markerPct != null && compareAmount != null && compareAmount > 0;

  // Relative positions of p25 / median / p75 on the same padded scale as the marker.
  const span = Math.max(band.p75 - band.p25, band.median * 0.01, 1);
  const left = band.p25 - span * 0.15;
  const right = band.p75 + span * 0.15;
  const scale = (v: number) =>
    Math.min(100, Math.max(0, ((v - left) / Math.max(right - left, 1)) * 100));
  const p25Pct = scale(band.p25);
  const medPct = scale(band.median);
  const p75Pct = scale(band.p75);

  return (
    <Collapsible
      title="Pricing comps"
      meta={
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          CPI-adjusted
          <InfoTip label="What does CPI-adjusted mean?">{cpiTip(year, seriesId)}</InfoTip>
        </span>
      }
      defaultOpen
    >
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        Past federal awards for{" "}
        <span className="font-medium text-slate-700">
          NAICS {naics ?? "this industry"}
          {state ? ` in ${state}` : ""}
        </span>
        , inflated to {year ?? "current"} dollars so older wins compare fairly.
        Use the band below to see whether your price looks low, typical, or high.
        <InfoTip label="What are pricing comps?">
          {termTip("pricing_comps") ??
            "Comparable past awards Brost Co pulls to estimate what similar jobs have paid."}
        </InfoTip>
      </p>

      <div className="space-y-2">
        <MetricRow
          label="Comps"
          tip={COMP_METRIC_TIPS.count}
          value={<span className="num">{band.count}</span>}
        />
        <MetricRow
          label="Median"
          tip={COMP_METRIC_TIPS.median}
          value={currency(band.median)}
        />
        <MetricRow
          label="Average"
          tip={COMP_METRIC_TIPS.average}
          value={currency(band.average)}
        />
        <MetricRow
          label="25th pct"
          tip={COMP_METRIC_TIPS.p25}
          value={currency(band.p25)}
        />
        <MetricRow
          label="75th pct"
          tip={COMP_METRIC_TIPS.p75}
          value={currency(band.p75)}
        />
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <p className="label mb-2 inline-flex items-center gap-1">
          Typical competitive range
          <InfoTip label="How to read this range">
            The shaded span is the middle 50% of historical awards (25th to 75th
            percentile). The tick is the median. Your marker shows where the
            selected price sits on that same scale.
          </InfoTip>
        </p>

        <div className="relative h-3 rounded-full bg-surface">
          <div
            className="absolute inset-y-0 rounded-full bg-accent/25"
            style={{ left: `${p25Pct}%`, width: `${Math.max(p75Pct - p25Pct, 1)}%` }}
          />
          <div
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-accent-strong"
            style={{ left: `${medPct}%` }}
            title={`Median ${currency(band.median)}`}
          />
          {showMarker && (
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pursue bg-background shadow-sm"
              style={{ left: `${position.markerPct}%` }}
              title={`${compareLabel ?? "Your price"} ${currency(compareAmount)}`}
            />
          )}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-slate-500">
          <span>Lower</span>
          <span>Median</span>
          <span>Higher</span>
        </div>

        {showMarker ? (
          <div className="mt-3 rounded-md border border-border bg-surface/70 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${TONE_CLASS[position.tone]}`}>{position.label}</span>
              <span className="text-xs text-slate-600">
                {compareLabel ?? "Your price"}{" "}
                <span className="num font-medium text-slate-800">
                  {currency(compareAmount)}
                </span>
                {position.vsMedianPct != null && (
                  <span className="text-slate-500">
                    {" "}
                    ({position.vsMedianPct > 0 ? "+" : ""}
                    {position.vsMedianPct}% vs median)
                  </span>
                )}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {position.explanation}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            Add a subcontractor quote or build a bid to plot your price on this range.
          </p>
        )}
      </div>

      {proxyNote && (
        <p className="mt-3 border-t border-border pt-2 text-[11px] leading-relaxed text-slate-500">
          {proxyNote}
        </p>
      )}
    </Collapsible>
  );
}
