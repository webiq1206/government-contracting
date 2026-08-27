import Link from "next/link";
import {
  latestKpiSnapshot,
  computeKpisFallback,
  analyticsExtras,
  customKpis,
} from "@/lib/data";
import { PageFrame } from "@/components/page-frame";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { KpiManager, KpiDeleteButton } from "@/components/kpi-manager";
import { MetricCard, MetricGroup } from "@/components/metric-card";
import {
  AnalyticsMobileNav,
  AnalyticsSection,
  AnalyticsFilterSheet,
} from "@/components/analytics-mobile";
import {
  deadlineMetrics,
  reviewMetrics,
  subcontractorMetrics,
  tradeCoverageMetrics,
  dataConfidenceMetrics,
  automationMetrics,
  pipelineValueReport,
  pinnedMetric,
} from "@/lib/reporting";
import { coverageSentence } from "@/lib/domain/report-metrics";
import { getMetric, describeKpiParams } from "@/lib/domain/kpi";
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
  breakdownNote,
  breakdownLines,
  type FunnelStep,
  type FunnelKey,
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
  absent,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  /**
   * Why there is no figure, when there is not.
   *
   * Separate from `value` so it can be set at reading size. "No wins yet" in
   * the same forty-point type as a real number competes with the cards that
   * have one, and on a phone it fills the screen: the eye reads the shape
   * before the words and takes a sentence for a headline figure.
   */
  absent?: string;
  sub?: React.ReactNode;
  /** Green accent for performance rates; near-black for currency (default). */
  accent?: boolean;
}) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      {absent ? (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{absent}</p>
      ) : (
        <div
          className={`num mt-1.5 text-4xl font-semibold tracking-tight ${
            accent ? "text-accent" : "text-slate-900"
          }`}
        >
          {value}
        </div>
      )}
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
  /*
   * By key, not by position. This read steps[6] for "Submitted", and adding
   * the replies step moved Submitted to seven, so the sentence would have
   * quietly started describing the bid-built row under the submitted heading.
   * Nothing would have failed; the page would just have been wrong.
   */
  const deltaFor = (key: FunnelKey) => {
    const i = steps.findIndex((s) => s.key === key);
    if (i < 0 || !priorSteps || !comparison) return null;
    if (steps[i].count + priorSteps[i].count === 0) return null;
    return describeDelta(compare(steps[i].count, priorSteps[i].count), comparison);
  };
  const foundDelta = deltaFor("found");
  const submittedDelta = deltaFor("submitted");
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
  /*
   * Pinned metrics go through the same path the reports do, so a pinned "Win
   * rate" and the reported one cannot come out different. A pinned metric
   * whose definition has been removed from the catalog is skipped rather than
   * rendered as a dash under a label nobody can explain.
   */
  const kpiValues = (
    await Promise.all(
      kpis.map(async (k) => {
        const def = getMetric(k.metric);
        if (!def) return null;
        return {
          id: k.id,
          params: k.params,
          metric: k.metric,
          computed: await pinnedMetric({ ...def, label: k.label }, k.params),
        };
      })
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);
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

  /*
   * The reported metrics, over the same window as the funnel above.
   *
   * Loaded together rather than one section at a time: they are six
   * independent queries and running them in sequence would make the page wait
   * six round trips for figures that do not depend on each other.
   *
   * The value report is given the measured win rate so its forecast can be a
   * forecast rather than a guess. Without a win rate it returns null and says
   * why, which is the correct answer on an account that has never had a bid
   * decided.
   */
  const [
    deadlines,
    reviewTimes,
    subOutreach,
    tradeCoverage,
    confidence,
    automation,
    valueReport,
  ] = await Promise.all([
    // The window runs from `from` up to now, which is what a null upper bound
    // means everywhere in this module; the funnel above uses the same one.
    deadlineMetrics(from, null),
    reviewMetrics(from, null),
    subcontractorMetrics(from, null),
    tradeCoverageMetrics(from, null),
    dataConfidenceMetrics(from, null),
    automationMetrics(from, null),
    pipelineValueReport(from, null, winRate),
  ]);

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
        {/*
          * On a phone both filters live behind one button instead. Thirteen
          * hundred pixels of chips above the fold is the numbers pushed off
          * the screen somebody opened the page to read.
          */}
        <AnalyticsFilterSheet range={range} by={by} comparison={comparison} />
        <div className="hidden flex-wrap items-center gap-2 lg:flex">
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

        {/*
          * One section at a time on a phone, everything at once above the
          * breakpoint. Numbers is listed first and selected by default,
          * because the figures are what somebody opens this page for and the
          * funnel is a nine-row table they would otherwise scroll past.
          */}
        <AnalyticsMobileNav
          sections={[
            { id: "numbers", label: "Numbers" },
            { id: "funnel", label: "Funnel" },
            { id: "reports", label: "Reports" },
            { id: "breakdown", label: "Breakdowns" },
            { id: "engine", label: "Deeper" },
          ]}
        >
        {/*
          Both panels describe the stored breakdowns, which live under Deeper,
          so on a phone they sit with what they explain instead of taking a
          third of the first screen before any figure appears. Desktop is
          unchanged: they stay exactly where they were.
        */}
        <AnalyticsSection id="engine">
        <div className="space-y-6">
        {!snapData && (
          <div className="callout-panel text-sm text-slate-700">
            Deeper breakdowns (win rate by NAICS, agency, geography, cash flow, sub
            rankings, velocity) appear after Analytics Engine runs.{" "}
            <Link
              href="/agents"
              className="inline-flex min-h-11 items-center font-medium text-accent hover:underline lg:min-h-0"
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

        </div>
        </AnalyticsSection>

        <AnalyticsSection id="funnel">
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

        </AnalyticsSection>

        <AnalyticsSection id="numbers">
        <div className="space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Win rate"
            value={winRate != null ? `${winRate}%` : null}
            absent={winRate == null ? "Not enough history yet." : undefined}
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
            value={avgMargin != null ? `${avgMargin}%` : null}
            absent={
              avgMargin != null
                ? undefined
                : (wins ?? 0) === 0
                  ? "No wins yet."
                  : "No won bid recorded a margin."
            }
            accent
          />
          <KpiCard
            label="Pipeline value"
            value={pipelineValued === 0 ? null : currency(pipelineValue)}
            absent={
              pipelineValued === 0
                ? "No open opportunity publishes a value."
                : undefined
            }
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

        </div>
        </AnalyticsSection>

        <AnalyticsSection id="reports">
        {/* The reported metrics, each able to say where it came from. */}
        <section aria-labelledby="reports-heading" className="space-y-5">
          <div className="border-b-2 border-accent/80 pb-2">
            <p className="eyebrow">{rangeLabel(range)}</p>
            <h2
              id="reports-heading"
              className="mt-0.5 font-display text-2xl font-semibold text-foreground"
            >
              Reports
            </h2>
            {/*
              What every figure below is measured against, said once rather
              than repeated on each card.
              The window is deliberately described as a rolling span of hours,
              because that is what the queries do: they subtract days in
              milliseconds from this instant. Claiming a timezone here would be
              claiming a calendar-day boundary that no query applies, and a
              false precision is worse than none.
            */}
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Counted over {rangeLabel(range).toLowerCase()}
              {comparison
                ? `, against ${comparison}`
                : ", with nothing before it to compare against"}
              . The window is a rolling span ending now, not calendar days, so no timezone
              boundary applies to what is in or out. Every figure is computed when the page
              loads rather than read from a stored snapshot, so it is as current as this
              page. Open any card to see how it is worked out.
            </p>
          </div>

          <MetricGroup
            title="What the open work is worth"
            description="Published, estimated, and unvalued are counted apart. A notice with no figure is not worth nought, and adding an estimate to a published total hides which is which."
            metrics={valueReport.metrics}
          />
          <div className="card">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <div className="label">Published value</div>
                <div className="num mt-1 text-2xl font-semibold text-slate-900">
                  {currency(valueReport.split.known.total)}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {valueReport.split.known.count} opportunit
                  {valueReport.split.known.count === 1 ? "y" : "ies"} carrying a figure from
                  the notice or from a person.
                </p>
              </div>
              <div>
                <div className="label">Estimated value</div>
                <div className="num mt-1 text-2xl font-semibold text-slate-900">
                  {currency(valueReport.split.modeled.total)}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {valueReport.split.modeled.count} where the figure was inferred from the
                  solicitation rather than published.
                </p>
              </div>
              <div>
                <div className="label">No figure at all</div>
                <div className="num mt-1 text-2xl font-semibold text-slate-900">
                  {valueReport.split.unknown.count}
                </div>
                {/*
                  Counted, never valued. This is the bucket that makes the two
                  totals beside it a floor rather than a forecast, and the one
                  a dashboard is most tempted to quietly treat as nought.
                */}
                <p className="mt-1 text-xs text-slate-500">
                  Open, and carrying no dollar figure. Not counted as nought in either
                  total.
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">{coverageSentence(valueReport.split)}</p>
          </div>

          <MetricGroup
            title="Deadlines and decisions"
            description="Whether work went in on time, and how long a pursue or pass call takes."
            metrics={[...deadlines, ...reviewTimes]}
          />
          <MetricGroup
            title="Subcontractor outreach"
            description="What happened to the emails, and how much of the work came back with a price on it."
            metrics={[...subOutreach, ...tradeCoverage]}
          />
          <MetricGroup
            title="How much the scores rest on"
            description="A score computed from a title and a NAICS code looks exactly like one computed from a full solicitation."
            metrics={confidence}
          />
          <MetricGroup
            title="Automation"
            description="Whether the platform's own work is finishing, and how much of it comes back to a person."
            metrics={automation}
          />
        </section>

        </AnalyticsSection>

        {/*
          Pinned metrics sit with the numbers on a phone: they are figures
          somebody chose to keep, so burying them behind a different tab from
          the headline ones would defeat the pinning.
        */}
        <AnalyticsSection id="numbers">
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
                  /*
                    The same card the reports use, so a pinned metric says
                    where it came from and why it has no value, exactly as the
                    reported one does. It used to print a bare dash for both
                    "nothing qualifies" and "the query failed".
                  */
                  <div key={k.id} className="relative">
                    <div className="absolute right-3 top-3 z-10">
                      <KpiDeleteButton id={k.id} />
                    </div>
                    <MetricCard metric={k.computed} />
                    {desc && (
                      <p className="mt-1 px-1 text-xs text-slate-500">{desc}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        </AnalyticsSection>

        <AnalyticsSection id="breakdown">
        <div className="space-y-6">
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
                {/*
                  How this dimension counts, where it is not one row per
                  opportunity. Trade is the case: an opportunity appears under
                  every trade it sourced, so the column totals more than the
                  pipeline, and a table that does not say so is one somebody
                  reconciles against Opportunities and stops trusting.
                */}
                {breakdownNote(by) && (
                  <>
                    <strong className="font-semibold text-slate-700">{breakdownNote(by)}</strong>{" "}
                  </>
                )}
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

        </div>
        </AnalyticsSection>

        <AnalyticsSection id="engine">
        <div className="space-y-6">
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
        </AnalyticsSection>
        </AnalyticsMobileNav>
      </div>
    </div>
  );
}
