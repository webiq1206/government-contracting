import { InfoTip } from "@/components/info-tip";
import { SubWorkNeeded } from "@/components/sub-work-needed";
import { outreachLabel } from "@/lib/domain/sub-contact";
import { resolveSubWork } from "@/lib/domain/sub-work";
import type { TradeCoverageSummary } from "@/lib/domain/trade-coverage";

export interface TradeCoverageSubLine {
  trade: string | null;
  company_name: string;
  outreach_state: string | null;
  has_quote: boolean;
}

/**
 * Required Pricing board: per-trade status with direct next actions.
 */
export function TradeCoverageStrip({
  coverage,
  subs = [],
  analysis = null,
  description = null,
}: {
  coverage: TradeCoverageSummary;
  /** Optional named lines under each trade (company + status). */
  subs?: TradeCoverageSubLine[];
  analysis?: Record<string, unknown> | null;
  description?: string | null;
}) {
  const { trades, totals } = coverage;
  if (trades.length === 0) return null;

  return (
    <div
      id="coverage"
      data-guide-target="coverage"
      className="scroll-mt-editorial rounded-md border border-border bg-background px-4 py-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Required pricing</p>
          <p className="mt-1 text-sm text-slate-600">
            Every required trade must reach &quot;Quote received&quot; before submission.
          </p>
        </div>
        <InfoTip label="About required pricing">
          Coverage is complete for a trade when at least one positive quote is on
          file. Draft or failed emails do not count as contacted.
        </InfoTip>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <Metric label="Found" value={totals.found} href="#subs" />
        <Metric label="Contacted" value={totals.contacted} href="#subs" />
        <Metric label="Responded" value={totals.responded} href="#subs" />
        <Metric label="Quotes" value={totals.quotes} href="#quotes" />
        <Metric
          label="Follow-ups due"
          value={totals.followUpDue}
          href="#subs"
          accent={totals.followUpDue > 0}
        />
        <Metric
          label="Trades needing quotes"
          value={totals.uncovered}
          href="#coverage"
          accent={totals.uncovered > 0}
        />
      </div>

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {trades.map((t) => {
          const lines = subs.filter(
            (s) => (s.trade?.trim() || "General") === t.trade
          );
          const tradeWork = resolveSubWork({
            trade: t.trade,
            analysis,
            description,
            maxChars: 320,
          });
          const cta =
            t.status === "complete"
              ? null
              : t.found === 0 || t.contacted === 0
                ? {
                    href: "#subs",
                    label: `Find and contact ${t.trade} subcontractors`,
                  }
                : {
                    href: "#quotes",
                    label: `Enter ${t.trade} quote`,
                  };
          return (
            <li key={t.trade} className="px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{t.trade}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t.status === "complete"
                      ? "Quote received"
                      : t.found === 0
                        ? "No subcontractors found"
                        : t.contacted === 0
                          ? "No subcontractors contacted"
                          : t.responded > 0
                            ? "Awaiting quote after response"
                            : "Awaiting response"}
                    {t.found > 0 && (
                      <>
                        {" "}
                        · {t.found} found · {t.contacted} contacted · {t.responded}{" "}
                        responded · {t.quotes} quote{t.quotes === 1 ? "" : "s"}
                      </>
                    )}
                  </p>
                  {tradeWork.work && (
                    <div className="mt-2">
                      <SubWorkNeeded work={tradeWork} variant="inline" />
                    </div>
                  )}
                  {cta && (
                    <a
                      href={cta.href}
                      className="btn-primary mt-2 inline-flex text-xs"
                    >
                      {cta.label}
                    </a>
                  )}
                </div>
                <span
                  className={`badge shrink-0 ${
                    t.status === "complete"
                      ? "bg-pursue/15 text-pursue"
                      : t.status === "action_required" || t.status === "empty"
                        ? "bg-risk/15 text-risk"
                        : "bg-review/15 text-review"
                  }`}
                >
                  {t.statusLabel}
                </span>
              </div>
              {lines.length > 0 && (
                <ul className="mt-2 space-y-1 border-l border-border pl-3">
                  {lines.slice(0, 6).map((s) => (
                    <li
                      key={`${t.trade}-${s.company_name}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs"
                    >
                      <span className="font-medium text-slate-800">{s.company_name}</span>
                      <span className="text-slate-500">
                        {s.has_quote
                          ? "Quote received"
                          : outreachLabel(s.outreach_state)}
                      </span>
                    </li>
                  ))}
                  {lines.length > 6 && (
                    <li className="text-xs text-slate-500">
                      +{lines.length - 6} more. See Subs below.
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  href,
}: {
  label: string;
  value: number;
  accent?: boolean;
  href?: string;
}) {
  const inner = (
    <>
      <span className="text-slate-400">{label} </span>
      <span className={`num font-semibold ${accent ? "text-risk" : "text-slate-800"}`}>
        {value}
      </span>
    </>
  );
  if (href) {
    return (
      <a href={href} className="hover:text-accent">
        {inner}
      </a>
    );
  }
  return <span>{inner}</span>;
}
