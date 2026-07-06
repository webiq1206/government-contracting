import { latestKpiSnapshot, computeKpisFallback } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { currency, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function str(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "—";
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
          accent ? "text-accent" : "text-neutral-900"
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
      <h3 className="mb-3 text-sm font-semibold text-neutral-900">{title}</h3>
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
              str(r[keyField] ?? r.key ?? r.name ?? r.label ?? r.code) || "—";
            return (
              <tr key={i} className="border-t border-border">
                <td className="td">{key}</td>
                <td className="td num">{winRate != null ? pct(winRate) : "—"}</td>
                <td className="td text-slate-500">
                  {wins != null || losses != null ? `${wins ?? 0} / ${losses ?? 0}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnalyticsPage() {
  const [snap, fb] = await Promise.all([latestKpiSnapshot(), computeKpisFallback()]);

  // Prefer richer snapshot fields where present, fall back to live-computed basics.
  const winRate = snap ? num(snap.win_rate) ?? fb.win_rate : fb.win_rate;
  const avgMargin = snap ? num(snap.avg_margin_on_wins) ?? fb.avg_margin_on_wins : fb.avg_margin_on_wins;
  const pipelineValue = snap ? num(snap.pipeline_value) ?? fb.pipeline_value : fb.pipeline_value;
  const activeRevenue = snap
    ? num(snap.active_contract_revenue) ?? fb.active_contract_revenue
    : fb.active_contract_revenue;
  const wins = snap ? num(snap.wins) ?? fb.wins : fb.wins;
  const losses = snap ? num(snap.losses) ?? fb.losses : fb.losses;

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
    <div className="flex h-screen flex-col">
      <PageHeader
        help={PAGE_HELP["analytics"]}
        title="Analytics"
        subtitle={
          snap
            ? "Latest snapshot from the Analytics Engine."
            : "Live-computed basics."
        }
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-auto p-5">
        {!snap && (
          <div className="card border-review/40 bg-review/5 text-sm text-slate-700">
            Analytics Engine has not run yet, so these numbers are computed live. Trigger it from
            Agents.
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Win rate"
            value={winRate != null ? `${winRate}%` : "—"}
            sub={`${wins ?? 0} wins · ${losses ?? 0} losses`}
            accent
          />
          <KpiCard
            label="Avg margin on wins"
            value={avgMargin != null ? `${avgMargin}%` : "—"}
            accent
          />
          <KpiCard label="Pipeline value" value={currency(pipelineValue)} />
          <KpiCard label="Active contract revenue" value={currency(activeRevenue)} />
        </div>
        <p className="text-xs text-slate-500">
          Win rate is wins divided by decided bids. Pipeline value is the total
          estimated value of everything still in play. These fill in as bids are
          decided, so early numbers will look sparse.
        </p>

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
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">Cash Flow Projection</h3>
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
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">Top Subcontractors</h3>
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
                      {num(r.score ?? r.reliability_score ?? r.rating) ?? "—"}
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
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">Pipeline Velocity</h3>
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
