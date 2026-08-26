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
import { PIPELINE_STAGES } from "@/lib/data";

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

const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.key, s.label])
);

export default async function AnalyticsPage() {
  const [snap, fb, extras, kpis] = await Promise.all([
    latestKpiSnapshot(),
    computeKpisFallback(),
    analyticsExtras(),
    customKpis(),
  ]);
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

  const byNaics = snap ? rows(snap.by_naics) : [];
  const byAgency = snap ? rows(snap.by_agency) : [];
  const byGeography = snap ? rows(snap.by_geography) : [];

  const cashFlow = snap && snap.cash_flow && typeof snap.cash_flow === "object"
    ? (snap.cash_flow as Record<string, unknown>)
    : null;
  const subRankings = snap ? rows(snap.sub_rankings) : [];
  const velocity = snap && snap.velocity && typeof snap.velocity === "object"
    ? (snap.velocity as Record<string, unknown>)
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
          snap
            ? "Headline numbers are live. Breakdowns below are from the latest Analytics Engine run."
            : "Headline numbers are live. Deeper breakdowns appear after Analytics Engine runs."
        }
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-auto p-5">
        {!snap && (
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

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Win rate"
            value={winRate != null ? `${winRate}%` : "-"}
            sub={`${wins ?? 0} wins · ${losses ?? 0} losses`}
            accent
          />
          <KpiCard
            label="Avg margin on wins"
            value={avgMargin != null ? `${avgMargin}%` : "-"}
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

        {/* Win rate breakdowns */}
        {(byNaics.length > 0 || byAgency.length > 0 || byGeography.length > 0) && (
          <>
          <p className="text-xs text-slate-500">
            Use these breakdowns to spot where you win most, then focus bids
            there. The weekly learning agent uses the same data to propose
            scoring adjustments.
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
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Cash Flow Projection</h3>
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
                      {currency(v)}
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
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Top Subcontractors</h3>
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
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Pipeline Velocity</h3>
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
