import Link from "next/link";
import {
  latestKpiSnapshot,
  computeKpisFallback,
  analyticsExtras,
  customKpis,
  computeCustomKpi,
} from "@/lib/data";
import { PageFrame } from "@/components/page-frame";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { KpiManager, KpiDeleteButton } from "@/components/kpi-manager";
import { getMetric, formatKpiValue, describeKpiParams } from "@/lib/domain/kpi";
import { currency, pct } from "@/lib/format";
import { PIPELINE_STAGES, funnelCounts, funnelBreakdown } from "@/lib/data";
import {
  buildFunnel,
  worstDropOff,
  formatRate,
  formatDays,
  parseRange,
  rangeDays,
  rangeLabel,
  comparisonLabel,
  compare,
  describeDelta,
  snapshotFreshness,
  RANGE_OPTIONS,
  BREAKDOWN_OPTIONS,
  parseBreakdown,
  breakdownLabel,
  breakdownLines,
  type FunnelStep,
} from "@/lib/domain/funnel";

export const dynamic = "force-dynamic";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function str(v: unknown): string {
  if (v == null) return "-";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "-";
}

/** A row in a defensively-rendered breakdown table. */
function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((r) => r && typeof r === "object") as Record<string, unknown>[]) : [];
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Green accent for performance rates; near-black for currency (default). */
  accent?: boolean;
}) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div
        className={`num mt-1.5 text-4xl font-semibold tracking-tight ${
          accent ? "text-accent" : "text-slate-900"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/** Small "win rate by X" table. label/rate fields discovered defensively. */
function BreakdownTable({
  title,
  data,
  keyField,
}: {
  title: string;
  data: Record<string, unknown>[];
  keyField: string;
}) {
  if (data.length === 0) return null;
  return (
    <div className="card scroll-thin overflow-x-auto">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      <table className="w-full">
        <thead>
          <tr>
            <th className="th">{keyField}</th>
            <th className="th">Win rate</th>
            <th className="th">W / L</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => {
            const winRate = num(r.win_rate ?? r.winRate ?? r.rate);
            const wins = num(r.wins ?? r.won);
            const losses = num(r.losses ?? r.lost);
            const key =
              str(r[keyField] ?? r.key ?? r.name ?? r.label ?? r.code) || "-";
            return (
              <tr key={i} className="border-t border-border">
                <td className="td">{key}</td>
                <td className="td num">{winRate != null ? pct(winRate) : "-"}</td>
                <td className="td text-slate-500">
                  {wins != null || losses != null ? `${wins ?? 0} / ${losses ?? 0}` : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One band of the funnel.
 *
 * The bar is scaled against everything found, so the shape of the drop is
 * visible without reading a single number, and the numbers underneath say what
 * the bar cannot: how much of the previous step converted, how long the step
 * took, how much stopped for good, and how much is still moving. A band with
 * no measured duration says so rather than showing a plausible zero.
 */
function FunnelBand({ step, total }: { step: FunnelStep; total: number }) {
  const width = total > 0 ? Math.max(1, Math.round((step.count / total) * 100)) : 0;
  return (
    <li className="border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900">{step.label}</span>
          {step.href ? (
            <Link
              href={step.href}
              className="tap text-xs text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-accent"
            >
              See them
            </Link>
          ) : null}
        </div>
        <div className="num text-sm text-slate-900">
          {step.count}
          {/*
            * A step that converted nothing and a step whose predecessor was
            * empty look identical if both print a bare zero, and they are not
            * the same fact. The first says the work stopped here; the second
            * says there was no work to stop. So one reads "none of the step
            * before" and the other prints no rate at all.
            */}
          {step.rateFromPrevious != null && (
            <span className="ml-2 text-xs font-normal text-slate-500">
              {step.count === 0
                ? "none of the step before"
                : `${formatRate(step.rateFromPrevious)} of the step before`}
            </span>
          )}
        </div>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="presentation"
      >
        <div className="h-full rounded-full bg-accent/70" style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
        {step.meaning}{" "}
        {step.medianDays != null && (
          <>Typically {formatDays(step.medianDays).toLowerCase()} to get here. </>
        )}
        {step.dropped > 0 && (
          <>
            {step.dropped} closed without reaching it.{" "}
          </>
        )}
        {step.pending > 0 && (
          <>{step.pending} stopped short but {step.pending === 1 ? "is" : "are"} still open.</>
        )}
      </p>
    </li>
  );
}

const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.key, s.label])
);

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  // The range lives in the URL, so a filtered view of the funnel is a link, the
  // back button works, and the server and the browser cannot disagree about
  // which window is being shown.
  const range = parseRange(searchParams?.range);
  const by = parseBreakdown(searchParams?.by);
  const days = rangeDays(range);
  const now = Date.now();
  const from = days == null ? null : new Date(now - days * 86_400_000);
  // The comparison window is the same length, immediately before. All time has
  // nothing before it, so it gets no comparison rather than a made-up one.
  const priorFrom = days == null ? null : new Date(now - days * 2 * 86_400_000);
  const [snap, fb, extras, kpis, funnel, priorFunnel] = await Promise.all([
    latestKpiSnapshot(),
    computeKpisFallback(),
    analyticsExtras(),
    customKpis(),
    funnelCounts(from),
    days == null ? Promise.resolve(null) : funnelCounts(priorFrom, from),
  ]);
  const breakdown = breakdownLines(await funnelBreakdown(by, from));
  const steps = buildFunnel(funnel);
  const worst = worstDropOff(steps);
  const priorSteps = priorFunnel ? buildFunnel(priorFunnel) : null;
  const comparison = comparisonLabel(range);
  // Comparing nothing with nothing is not a comparison. "No change from the
  // 30 days before that" on an account that has submitted nothing in either
  // period fills a line with no information, so both sides must be non-empty
  // for the sentence to appear at all.
  const deltaFor = (i: number) =>
    priorSteps && comparison && steps[i].count + priorSteps[i].count > 0
      ? describeDelta(compare(steps[i].count, priorSteps[i].count), comparison)
      : null;
  const foundDelta = deltaFor(0);
  const submittedDelta = deltaFor(6);
  const freshness = snapshotFreshness(snap?.generatedAt ?? null);
  /** Keeps every other choice in the URL when one of them changes. */
  const hrefWith = (name: string, value: string) => {
    const p = new URLSearchParams();
    for (const [key, v] of Object.entries(searchParams ?? {})) {
      if (key === name) continue;
      if (typeof v === "string") p.set(key, v);
    }
    p.set(name, value);
    return `/analytics?${p.toString()}`;
  };
  // Compute each operator-defined KPI live (each is a bounded, safe query).
  const kpiValues = await Promise.all(
    kpis.map(async (k) => ({
      ...k,
      value: await computeCustomKpi(k.metric, k.params),
      unit: getMetric(k.metric)?.unit ?? "count",
    }))
  );
  // Stages that actually hold value, largest first, for the by-stage breakdown.
  const stageValue = extras.byStage
    .filter((s) => s.value > 0 || s.count > 0)
    .sort((a, b) => b.value - a.value);

  // Headline KPIs read LIVE, not from the stored snapshot. These are point-in-
  // time / cumulative values the live query always computes correctly and
  // currently; the snapshot is only a stale copy of them (a stale 0 used to hide
  // real pipeline value). The snapshot still powers the richer breakdowns below
  // (by NAICS/agency/geography, cash flow, sub rankings, velocity), which have no
  // live equivalent.
  const winRate = fb.win_rate;
  const avgMargin = fb.avg_margin_on_wins;
  const pipelineValue = fb.pipeline_value;
  // Coverage, so the figure can say what it actually describes. A total over
  // 2 of 41 opportunities is not "the pipeline", and printing it as though it
  // were is the difference between a number and a misleading number.
  const pipelineValued = fb.pipeline_valued;
  const pipelineTotal = fb.pipeline_total;
  const pipelineCoverage =
    pipelineTotal === 0
      ? null
      : pipelineValued === pipelineTotal
        ? "all have a published value"
        : pipelineValued === 0
          ? `none of ${pipelineTotal} publish a value`
          : `from ${pipelineValued} of ${pipelineTotal} that publish one`;
  const activeRevenue = fb.active_contract_revenue;
  const wins = fb.wins;
  const losses = fb.losses;

  const snapData = snap?.data ?? null;
  const byNaics = snapData ? rows(snapData.by_naics) : [];
  const byAgency = snapData ? rows(snapData.by_agency) : [];
  const byGeography = snapData ? rows(snapData.by_geography) : [];

  const cashFlow =
    snapData && snapData.cash_flow && typeof snapData.cash_flow === "object"
      ? (snapData.cash_flow as Record<string, unknown>)
      : null;
  const subRankings = snapData ? rows(snapData.sub_rankings) : [];
  const velocity =
    snapData && snapData.velocity && typeof snapData.velocity === "object"
      ? (snapData.velocity as Record<string, unknown>)
      : null;

  return (
    <div className="flex page-shell">
      <PageFrame
        help={PAGE_HELP["analytics"]}
        title="Analytics"
        status={
          winRate != null
            ? `${winRate}% win rate${
                pipelineValued > 0 ? ` · ${currency(pipelineValue)} in pipeline` : ""
              }`
            : `${extras.counts.open_opps} open opportunit${extras.counts.open_opps === 1 ? "y" : "ies"}`
        }
        explanation={
          snapData
            ? `Headline numbers and the funnel are computed now. The stored breakdowns lower down are older: ${freshness.label.toLowerCase()}.`
            : "Headline numbers and the funnel are computed now. Deeper breakdowns appear after Analytics Engine runs."
        }
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-auto p-5">
        {/*
          * The date range. Everything cohort-based below it moves together, and
          * the selected range is in the URL so the view can be sent to somebody.
          */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="label" id="range-label">
            Period
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="range-label">
            {RANGE_OPTIONS.map((o) => (
              <Link
                key={o.key}
                href={hrefWith("range", o.key)}
                aria-current={o.key === range ? "true" : undefined}
                className={`tap rounded-full border px-3 py-1 text-xs font-medium ${
                  o.key === range
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-slate-600 hover:border-accent/50"
                }`}
              >
                {o.label}
              </Link>
            ))}
          </div>
          {comparison && (
            <span className="text-xs text-slate-500">compared with {comparison}</span>
          )}
        </div>

        {!snapData && (
          <div className="callout-panel text-sm text-slate-700">
            Deeper breakdowns (win rate by NAICS, agency, geography, cash flow, sub
            rankings, velocity) appear after Analytics Engine runs.{" "}
            <Link
              href="/agents"
              className="inline-flex min-h-11 items-center font-medium text-accent hover:underline md:min-h-0"
            >
              Run it from Automation Health
            </Link>
            .
          </div>
        )}

        {/*
          * Where every number on this page comes from. The audit asks for data
          * freshness and a known-versus-modeled explanation, and the honest
          * answer differs by section: the funnel and the headline figures are
          * counted from records at the moment the page loads, the breakdowns
          * are a stored copy with a date on it, and exactly one panel is a
          * projection rather than a count.
          */}
        <div className="callout-panel space-y-1 text-xs leading-relaxed text-slate-600">
          <p>
            <strong className="font-semibold text-slate-900">Counted now:</strong> the funnel
            and every headline figure, read straight from your records as this page loaded.
            Nothing on this page is estimated except where it says so.
          </p>
          <p>
            <strong className="font-semibold text-slate-900">Stored:</strong>{" "}
            {snapData
              ? `${freshness.label} by the Analytics Engine. Win rate by NAICS, agency and geography, sub rankings and velocity come from that run, so they lag anything decided since.`
              : "the Analytics Engine has not produced a breakdown yet, so those sections are absent rather than empty."}
            {freshness.stale && snapData
              ? " That is old enough to be worth re-running before you act on it."
              : ""}
          </p>
          {cashFlow && (
            <p>
              <strong className="font-semibold text-slate-900">Projected:</strong> Cash Flow
              Projection only. It models money not yet received, so it is the one panel here
              that is a forecast rather than a fact.
            </p>
          )}
        </div>

        {/* The funnel the audit names, over the selected period. */}
        <section aria-labelledby="funnel-heading">
          <div className="mb-3 border-b-2 border-accent/80 pb-2">
            <p className="eyebrow">{rangeLabel(range)}</p>
            <h2
              id="funnel-heading"
              className="mt-0.5 font-display text-2xl font-semibold text-foreground"
            >
              From found to decided
            </h2>
          </div>
          {steps[0].count === 0 ? (
            <EmptyState
              title={`Nothing was found in the ${rangeLabel(range).toLowerCase()}`}
              description="The funnel follows one batch of opportunities from the moment they arrived. Widen the period, or check that the source feeds are still bringing work in."
              action={
                <Link href="/agents" className="btn-ghost text-sm">
                  Check the feeds
                </Link>
              }
            />
          ) : (
            <div className="card">
              <p className="mb-3 text-xs leading-relaxed text-slate-500">
                One batch of {steps[0].count} opportunit
                {steps[0].count === 1 ? "y" : "ies"} found in this period, followed to
                wherever each one got to since. Work that stopped short is split between
                what has closed and what is still moving, because a bid that has not been
                submitted yet is not a bid that was lost.
              </p>
              <ul className="mb-0">
                {steps.map((st) => (
                  <FunnelBand key={st.key} step={st} total={steps[0].count} />
                ))}
              </ul>
              <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs leading-relaxed text-slate-600">
                <p>
                  <strong className="font-semibold text-slate-900">Decided:</strong>{" "}
                  {funnel.won + funnel.lost === 0
                    ? "nothing from this batch has been decided yet, so there is no win rate for it."
                    : `${funnel.won} won and ${funnel.lost} lost, a ${formatRate(
                        Math.round((funnel.won / (funnel.won + funnel.lost)) * 1000) / 10
                      )} win rate on this batch.`}
                </p>
                {worst && (
                  <p>
                    <strong className="font-semibold text-slate-900">Biggest loss:</strong>{" "}
                    {worst.dropped} closed before reaching {worst.label.toLowerCase()}. That
                    is where the most finished work stops.
                  </p>
                )}
                {foundDelta && (
                  <p>
                    <strong className="font-semibold text-slate-900">Found:</strong>{" "}
                    {foundDelta}.
                  </p>
                )}
                {submittedDelta && (
                  <p>
                    <strong className="font-semibold text-slate-900">Submitted:</strong>{" "}
                    {submittedDelta}.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Win rate"
            value={winRate != null ? `${winRate}%` : "Not enough history"}
            /*
             * "0 wins · 0 losses" reads as a track record of failure on an
             * account that has simply never submitted anything, and `?? 0`
             * turns an uncounted value into a real-looking zero. An account
             * with no decided bids has no win rate -- that is a different
             * fact from a win rate of nought, and the edge-case sweep caught
             * this on all three scenarios.
             */
            sub={
              (wins ?? 0) + (losses ?? 0) === 0
                ? "No bids decided yet"
                : `${wins ?? 0} won · ${losses ?? 0} lost`
            }
            accent
          />
          <KpiCard
            label="Avg margin on wins"
            value={avgMargin != null ? `${avgMargin}%` : (wins ?? 0) === 0 ? "No wins yet" : "Not recorded"}
            accent
          />
          <KpiCard
            label="Pipeline value"
            value={pipelineValued === 0 ? "Not published" : currency(pipelineValue)}
            sub={pipelineCoverage ?? undefined}
          />
          <KpiCard label="Active contract revenue" value={currency(activeRevenue)} />
        </div>
        <p className="text-xs text-slate-500">
          Win rate is wins divided by decided bids. Pipeline value adds up the
          opportunities that publish an estimate, and many federal notices do
          not, so it is a floor rather than a forecast: the card says how many
          it covers. These fill in as bids are decided, so early numbers look
          sparse.
        </p>

        {/* Live activity, computed straight from the data (no engine run needed). */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Open opportunities" value={extras.counts.open_opps} />
          <KpiCard label="New (30 days)" value={extras.counts.new_30d} />
          <KpiCard label="Bids submitted (30 days)" value={extras.counts.bids_30d} />
          <KpiCard label="Active contracts" value={extras.counts.active_contracts} />
        </div>

        {/* Custom, operator-defined KPIs. */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3 border-b-2 border-accent/80 pb-2">
            <div>
              <p className="eyebrow">Your metrics</p>
              <h2 className="mt-0.5 font-display text-2xl font-semibold text-foreground">
                Custom KPIs
              </h2>
            </div>
            <KpiManager />
          </div>
          {kpiValues.length === 0 ? (
            <EmptyState
              title="No custom KPIs yet"
              description="Pin the numbers you care about. Add a KPI, pick a metric, and it shows here every time you open Analytics."
              action={<KpiManager />}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpiValues.map((k) => {
                const desc = describeKpiParams(k.metric, k.params);
                return (
                  <div key={k.id} className="card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="label">{k.label}</div>
                      <KpiDeleteButton id={k.id} />
                    </div>
                    <div className="num mt-1.5 text-4xl font-semibold tracking-tight text-slate-900">
                      {formatKpiValue(k.value, k.unit)}
                    </div>
                    {desc && <div className="mt-1.5 text-xs text-slate-500">{desc}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Where the pipeline value is sitting, by stage. */}
        {stageValue.length > 0 && (
          <div className="card scroll-thin overflow-x-auto">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Pipeline value by stage
            </h3>
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              Federal notices often publish no dollar figure, so these totals cover only the
              opportunities that carry one. The last column says how many that is, because a
              total across 2 of 41 is not the value of the stage.
            </p>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Stage</th>
                  <th className="th">Opportunities</th>
                  <th className="th">Estimated value</th>
                  <th className="th">Value known for</th>
                </tr>
              </thead>
              <tbody>
                {stageValue.map((s) => (
                  <tr key={s.stage} className="border-t border-border">
                    <td className="td">{STAGE_LABEL[s.stage] ?? s.stage.replace(/_/g, " ")}</td>
                    <td className="td num">{s.count}</td>
                    {/* Never print $0 for "no estimate on file". A total that
                        covers 2 of 41 opportunities is not the value of the
                        stage, and saying so is the difference between a
                        number and a misleading number. */}
                    <td className="td num">
                      {s.valued === 0 ? (
                        <span className="text-slate-500">Not published</span>
                      ) : (
                        currency(s.value)
                      )}
                    </td>
                    <td className="td text-xs text-slate-500">
                      {s.valued === 0
                        ? `none of ${s.count}`
                        : s.valued === s.count
                          ? "all"
                          : `${s.valued} of ${s.count}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          * The drill-down. One row per value of the chosen dimension, over the
          * same cohort as the funnel, so the two always agree. Every rate here
          * can be absent: a row with nothing pursued has no submission rate,
          * and a row with nothing decided has no win rate. Printing those as
          * 0% would mark an agency you have never bid on as a losing one.
          */}
        <section aria-labelledby="drilldown-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b-2 border-accent/80 pb-2">
            <div>
              <p className="eyebrow">{rangeLabel(range)}</p>
              <h2
                id="drilldown-heading"
                className="mt-0.5 font-display text-2xl font-semibold text-foreground"
              >
                Broken down by {breakdownLabel(by).toLowerCase()}
              </h2>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Break down by">
              {BREAKDOWN_OPTIONS.map((o) => (
                <Link
                  key={o.key}
                  href={hrefWith("by", o.key)}
                  aria-current={o.key === by ? "true" : undefined}
                  className={`tap rounded-full border px-3 py-1 text-xs font-medium ${
                    o.key === by
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-surface text-slate-600 hover:border-accent/50"
                  }`}
                >
                  {o.label}
                </Link>
              ))}
            </div>
          </div>
          {breakdown.length === 0 ? (
            <EmptyState
              title="Nothing to break down yet"
              description="This table cuts the same batch as the funnel above. Once opportunities arrive in the selected period, they appear here grouped by whichever dimension you pick."
            />
          ) : (
            <div className="card scroll-thin overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">
                  {breakdownLabel(by)} breakdown of opportunities found in the{" "}
                  {rangeLabel(range).toLowerCase()}
                </caption>
                <thead>
                  <tr>
                    <th className="th">{breakdownLabel(by)}</th>
                    <th className="th">Found</th>
                    <th className="th">Pursued</th>
                    <th className="th">Submitted</th>
                    <th className="th">Decided</th>
                    <th className="th">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="td">{r.key}</td>
                      <td className="td num">{r.found}</td>
                      <td className="td num">
                        {r.pursued}
                        {r.pursuitRate != null && r.pursued > 0 && (
                          <span className="ml-1.5 text-xs font-normal text-slate-500">
                            {r.pursuitRate}%
                          </span>
                        )}
                      </td>
                      <td className="td num">
                        {r.submitted}
                        {/* A rate beside a zero only repeats the zero. */}
                        {r.submissionRate != null && r.submitted > 0 && (
                          <span className="ml-1.5 text-xs font-normal text-slate-500">
                            {r.submissionRate}% of pursued
                          </span>
                        )}
                      </td>
                      <td className="td text-xs text-slate-600">
                        {r.won + r.lost === 0 ? (
                          <span className="text-slate-500">
                            {r.undecided > 0 ? `${r.undecided} still with the agency` : "None yet"}
                          </span>
                        ) : (
                          <>
                            {r.won} won · {r.lost} lost
                            {r.undecided > 0 ? ` · ${r.undecided} pending` : ""}
                          </>
                        )}
                      </td>
                      <td className="td num">
                        {r.winRate == null ? (
                          <span className="text-xs font-normal text-slate-500">
                            Nothing decided
                          </span>
                        ) : (
                          `${r.winRate}%`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Win rate is wins over decided bids, so a bid still sitting with the agency
                does not count against you. Rows with nothing decided say so instead of
                showing nought per cent. The top 25 values are listed.
              </p>
            </div>
          )}
        </section>

        {/* Win rate breakdowns */}
        {(byNaics.length > 0 || byAgency.length > 0 || byGeography.length > 0) && (
          <>
          <p className="text-xs text-slate-500">
            <strong className="font-semibold text-slate-700">{freshness.label}</strong>, and
            covering all history rather than the period selected above. Use them to spot
            where you win most, then focus bids there. The weekly learning agent uses the
            same data to propose scoring adjustments.
            {freshness.stale ? " Re-run the Analytics Engine before relying on them." : ""}
          </p>
          <div className="grid gap-6 lg:grid-cols-3">
            <BreakdownTable title="Win rate by NAICS" data={byNaics} keyField="naics" />
            <BreakdownTable title="Win rate by Agency" data={byAgency} keyField="agency" />
            <BreakdownTable
              title="Win rate by Geography"
              data={byGeography}
              keyField="state"
            />
          </div>
          </>
        )}

        {/* Cash flow projection 30/60/90 */}
        {cashFlow && (
          <div className="card">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Cash Flow Projection</h3>
            {/* The one modelled panel on the page, and it says so. Everything
                else here is counted; this is a forecast of money not yet
                received, and reading it as a balance would be a mistake. */}
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              A projection, not a balance: expected receipts from active contracts, not money
              in the account. {freshness.label} by the Analytics Engine.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {["30", "60", "90"].map((d) => {
                const v =
                  num(cashFlow[d]) ??
                  num(cashFlow[`day_${d}`]) ??
                  num(cashFlow[`d${d}`]);
                return (
                  <div key={d} className="rounded-md border border-border bg-surface p-3">
                    <div className="label">{d}-day</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {v == null ? (
                        <span className="text-sm font-normal text-slate-500">
                          Not projected
                        </span>
                      ) : (
                        currency(v)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sub rankings */}
        {subRankings.length > 0 && (
          <div className="card scroll-thin overflow-x-auto">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Top Subcontractors</h3>
            <p className="mb-3 text-xs text-slate-500">{freshness.label} by the Analytics Engine.</p>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Sub</th>
                  <th className="th">Score</th>
                </tr>
              </thead>
              <tbody>
                {subRankings.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="td">
                      {str(r.company_name ?? r.name ?? r.sub ?? r.label)}
                    </td>
                    <td className="td num">
                      {num(r.score ?? r.reliability_score ?? r.rating) ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pipeline velocity */}
        {velocity && Object.keys(velocity).length > 0 && (
          <div className="card">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Pipeline Velocity</h3>
            <p className="mb-3 text-xs text-slate-500">{freshness.label} by the Analytics Engine.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(velocity).map(([stage, count]) => (
                <div
                  key={stage}
                  className="rounded-md border border-border bg-surface p-3"
                >
                  <div className="label">{stage.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {num(count) ?? str(count)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
