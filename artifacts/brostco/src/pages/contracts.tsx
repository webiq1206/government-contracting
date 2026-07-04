import { useGetContracts } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import { currency, shortDate, pct } from "@/lib/format";

interface Milestone {
  name?: string;
  due?: string;
  status?: string;
  amount?: number;
}

function milestoneClass(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "complete": case "completed": case "done": return "bg-pursue/15 text-pursue";
    case "in_progress": case "active": return "bg-brand-500/15 text-brand-400";
    case "overdue": case "late": case "blocked": return "bg-risk/15 text-risk";
    default: return "bg-review/15 text-review";
  }
}

function NonSsGauge({ pctValue }: { pctValue: number }) {
  const cap = 50;
  const ratio = Math.min(1, Math.max(0, pctValue / cap));
  const barClass = pctValue >= 49 ? "bg-risk" : pctValue >= 45 ? "bg-review" : "bg-pursue";
  const textClass = pctValue >= 49 ? "text-risk" : pctValue >= 45 ? "text-review" : "text-pursue";
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="label">Non-SS sub spend</p>
        <span className={`text-sm font-semibold ${textClass}`}>{pct(pctValue)} of 50% cap</span>
      </div>
      <div className="relative mt-1 h-2.5 w-full overflow-hidden rounded-full bg-ink-700">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${ratio * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-slate-500" style={{ left: `${(45 / cap) * 100}%` }} title="45% alert" />
      </div>
    </div>
  );
}

export default function ContractsPage() {
  const { data: contracts = [], isLoading } = useGetContracts();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Active Contracts"
        subtitle={isLoading ? "Loading..." : `${contracts.length} active contract${contracts.length === 1 ? "" : "s"}`}
      />
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        {contracts.length === 0 && !isLoading && (
          <div className="card text-sm text-slate-400">No active contracts yet.</div>
        )}
        {(contracts as Record<string, unknown>[]).map((c) => {
          const milestones = (c.milestones as Milestone[] | null) ?? [];
          const nonSsPct = Number(c.non_ss_sub_pct ?? 0);
          const cparsStatus = String(c.cpars_status ?? "pending");

          return (
            <div key={String(c.id)} className="card space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-100">{String(c.opportunity_title ?? c.contract_number ?? "Contract")}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{String(c.agency ?? "—")}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-neutral-900">{currency(c.award_amount != null ? Number(c.award_amount) : null)}</p>
                  {c.start_date && <p className="text-xs text-slate-500">{shortDate(String(c.start_date))} – {shortDate(String(c.end_date ?? ""))}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div><p className="label">Primary sub</p><p className="mt-0.5 text-sm text-slate-200">{String(c.primary_sub_name ?? "—")}</p></div>
                <div><p className="label">Backup sub</p><p className="mt-0.5 text-sm text-slate-200">{String(c.backup_sub_name ?? "—")}</p></div>
                <div>
                  <p className="label">CPARS</p>
                  <span className={`badge mt-0.5 ${cparsStatus === "received" ? "bg-pursue/15 text-pursue" : cparsStatus === "requested" ? "bg-brand-600/15 text-brand-400" : "bg-review/15 text-review"}`}>{cparsStatus}</span>
                </div>
              </div>

              <NonSsGauge pctValue={nonSsPct} />

              {milestones.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-slate-300">Milestones ({milestones.length})</summary>
                  <div className="mt-2 space-y-1.5">
                    {milestones.map((m, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-slate-300">{m.name ?? "Milestone"}</span>
                        <div className="flex items-center gap-2">
                          {m.amount != null && <span className="font-mono text-xs text-slate-400">{currency(m.amount)}</span>}
                          {m.due && <span className="text-xs text-slate-500">{shortDate(m.due)}</span>}
                          <span className={`badge ${milestoneClass(m.status)}`}>{m.status ?? "pending"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
