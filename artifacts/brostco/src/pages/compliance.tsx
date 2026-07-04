import { useGetCompliance } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import { shortDate } from "@/lib/format";

const CATEGORY_LABELS: Record<string, string> = {
  sam_registration: "SAM.gov Registration",
  certification: "Certifications",
  state_llc: "State / LLC Registration",
  insurance: "Insurance",
  non_ss_cap: "Non-Small-Business Sub Cap",
  contract_deadline: "Contract Deadlines",
};

const STATUS_COLOR: Record<string, string> = {
  ok: "bg-pursue/15 text-pursue",
  warning: "bg-review/15 text-review",
  critical: "bg-risk/15 text-risk",
  blocked: "bg-risk/20 text-risk font-semibold",
  resolved: "bg-ink-700 text-slate-400",
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.split(/[_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

interface CompItem {
  id: string;
  category: string;
  label: string;
  status: string;
  due_at: string | null;
  days_remaining: number | null;
  detail: Record<string, unknown> | null;
  last_checked_at: string | null;
  updated_at: string;
}

export default function CompliancePage() {
  const { data: rows = [], isLoading } = useGetCompliance();

  if (isLoading) return (
    <div className="flex h-full flex-col">
      <PageHeader title="Compliance Board" />
      <div className="p-6 text-sm text-slate-400">Loading...</div>
    </div>
  );

  if (rows.length === 0) return (
    <div className="flex h-full flex-col">
      <PageHeader title="Compliance Board" />
      <div className="p-6">
        <div className="card text-sm text-slate-400">
          Compliance Monitor has not run yet — trigger it from{" "}
          <a href="/agents" className="text-brand-400 hover:underline">Agents</a>.
        </div>
      </div>
    </div>
  );

  const items = rows as CompItem[];
  const urgent = items.filter((r) => r.status === "blocked" || r.status === "critical");
  const groups = new Map<string, CompItem[]>();
  for (const r of items) {
    const cat = r.category || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(r);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Compliance Board" subtitle={`${items.length} items tracked. ${urgent.length} need attention.`} />
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
        {urgent.length > 0 && (
          <section>
            <h2 className="label mb-2 text-risk">Needs attention now</h2>
            <div className="space-y-2">
              {urgent.map((r) => (
                <div key={r.id} className="card border-risk/40 bg-risk/5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-100">{r.label}</p>
                    <span className={`badge ${STATUS_COLOR[r.status] ?? "bg-ink-700 text-slate-400"}`}>{r.status}</span>
                  </div>
                  {r.due_at && <p className="mt-1 text-xs text-slate-400">Due: {shortDate(r.due_at)}{r.days_remaining != null ? ` (${r.days_remaining}d remaining)` : ""}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
        {Array.from(groups.entries()).map(([cat, catItems]) => (
          <section key={cat}>
            <h2 className="label mb-2">{categoryLabel(cat)}</h2>
            <div className="card overflow-hidden p-0">
              <table className="w-full border-collapse">
                <tbody>
                  {catItems.map((r) => (
                    <tr key={r.id} className="border-b border-ink-800/40 last:border-0">
                      <td className="td">
                        <p className="text-sm text-slate-100">{r.label}</p>
                        {r.last_checked_at && <p className="mt-0.5 text-xs text-slate-500">Checked {shortDate(r.last_checked_at)}</p>}
                      </td>
                      <td className="td w-40 text-right">
                        {r.due_at && <p className="text-xs text-slate-400">{shortDate(r.due_at)}{r.days_remaining != null ? ` · ${r.days_remaining}d` : ""}</p>}
                        <span className={`badge mt-1 ${STATUS_COLOR[r.status] ?? "bg-ink-700 text-slate-400"}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
