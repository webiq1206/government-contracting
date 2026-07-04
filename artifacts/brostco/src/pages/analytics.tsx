import { useGetKpis, useGetPipelineSummary } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import { currency, pct } from "@/lib/format";

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function BreakdownTable({ title, data, keyField }: { title: string; data: Record<string, unknown>[]; keyField: string }) {
  if (data.length === 0) return null;
  return (
    <div className="card">
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
            const winRate = r.win_rate != null ? Number(r.win_rate) : null;
            const wins = r.wins != null ? Number(r.wins) : null;
            const losses = r.losses != null ? Number(r.losses) : null;
            const key = String(r[keyField] ?? r.key ?? r.name ?? r.label ?? "—");
            return (
              <tr key={i} className="border-t border-ink-800/60">
                <td className="td">{key}</td>
                <td className="td font-mono">{winRate != null ? pct(winRate) : "—"}</td>
                <td className="td text-slate-500">{wins != null || losses != null ? `${wins ?? 0} / ${losses ?? 0}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface BidCoverageRow {
  opportunity_id: string;
  opportunity_title: string | null;
  quote_count: number;
  min_quote: number | null;
  max_quote: number | null;
  avg_quote: number | null;
}

function BidCoverageCard({ rows }: { rows: BidCoverageRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold text-neutral-900">Bid Coverage</h3>
      <p className="mb-3 text-xs text-slate-500">Quote amounts collected per active opportunity.</p>
      <table className="w-full">
        <thead>
          <tr>
            <th className="th">Opportunity</th>
            <th className="th">Quotes</th>
            <th className="th">Low</th>
            <th className="th">High</th>
            <th className="th">Avg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.opportunity_id} className="border-t border-ink-800/60">
              <td className="td">
                <a href={`/opportunity/${r.opportunity_id}`} className="text-sm text-brand-400 hover:underline line-clamp-1">
                  {r.opportunity_title ?? "Untitled"}
                </a>
              </td>
              <td className="td font-mono text-sm">{r.quote_count}</td>
              <td className="td font-mono text-sm text-pursue">{r.min_quote != null ? currency(r.min_quote) : "—"}</td>
              <td className="td font-mono text-sm">{r.max_quote != null ? currency(r.max_quote) : "—"}</td>
              <td className="td font-mono text-sm text-slate-400">{r.avg_quote != null ? currency(r.avg_quote) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsPage() {
  const { data: kpis, isLoading } = useGetKpis();
  const { data: pipeline } = useGetPipelineSummary();

  if (isLoading) return (
    <div className="flex h-screen flex-col">
      <PageHeader title="Analytics" />
      <div className="p-6 text-sm text-slate-400">Loading KPIs...</div>
    </div>
  );

  const winRate = kpis?.win_rate != null ? Number(kpis.win_rate) : null;
  const avgMargin = kpis?.avg_margin_on_wins != null ? Number(kpis.avg_margin_on_wins) : null;
  const pipelineValue = kpis?.pipeline_value != null ? Number(kpis.pipeline_value) : null;
  const activeRevenue = kpis?.active_contract_revenue != null ? Number(kpis.active_contract_revenue) : null;
  const byNaics = (kpis as Record<string, unknown> | undefined)?.by_naics as Record<string, unknown>[] ?? [];
  const byAgency = (kpis as Record<string, unknown> | undefined)?.by_agency as Record<string, unknown>[] ?? [];
  const bidCoverage = ((pipeline as Record<string, unknown> | undefined)?.bid_coverage as BidCoverageRow[] | undefined) ?? [];

  return (
    <div className="flex h-screen flex-col">
      <PageHeader title="Analytics" subtitle="Performance metrics and pipeline health." />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Win Rate" value={winRate != null ? pct(winRate) : "—"} sub={`${kpis?.total_won ?? 0} / ${kpis?.total_bids ?? 0} bids`} />
          <KpiCard label="Avg. Margin on Wins" value={avgMargin != null ? pct(avgMargin) : "—"} />
          <KpiCard label="Pipeline Value" value={pipelineValue != null ? currency(pipelineValue) : "—"} sub={`${kpis?.active_opportunities ?? 0} active opps`} />
          <KpiCard label="Active Contract Revenue" value={activeRevenue != null ? currency(activeRevenue) : "—"} />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <KpiCard label="Total Subcontractors" value={kpis?.total_subs ?? "—"} />
          <KpiCard label="Active Opportunities" value={kpis?.active_opportunities ?? "—"} />
          <KpiCard label="Total Bids Submitted" value={kpis?.total_bids ?? "—"} />
        </div>
        <BidCoverageCard rows={bidCoverage} />
        {byNaics.length > 0 && <BreakdownTable title="Win Rate by NAICS" data={byNaics} keyField="naics_code" />}
        {byAgency.length > 0 && <BreakdownTable title="Win Rate by Agency" data={byAgency} keyField="agency" />}
        {byNaics.length === 0 && byAgency.length === 0 && (
          <div className="card text-sm text-slate-400">
            Detailed breakdowns appear after the Analytics Engine runs. Trigger it from{" "}
            <a href="/agents" className="text-brand-400 hover:underline">Agents</a>.
          </div>
        )}
      </div>
    </div>
  );
}
