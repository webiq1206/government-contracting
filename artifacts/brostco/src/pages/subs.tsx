import { useState } from "react";
import { Link } from "wouter";
import { useGetSubs } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import type { Subcontractor } from "@/lib/types";

export default function SubsPage() {
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const [q, setQ] = useState("");
  const [minReliability, setMinReliability] = useState("");

  const params: Record<string, unknown> = {};
  if (trade) params.trade = trade;
  if (state) params.state = state;
  if (q) params.q = q;
  if (minReliability) params.minReliability = Number(minReliability);

  const { data: subs = [], isLoading } = useGetSubs(params as never);

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Sub Database"
        subtitle={isLoading ? "Loading..." : `${subs.length} subcontractor${subs.length === 1 ? "" : "s"}${trade || state || q || minReliability ? " matching filters" : ""}`}
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-4 py-3">
        <input placeholder="Search..." className="input w-40" value={q} onChange={(e) => setQ(e.target.value)} />
        <input placeholder="Trade..." className="input w-36" value={trade} onChange={(e) => setTrade(e.target.value)} />
        <input placeholder="State (e.g. CA)" className="input w-28" value={state} onChange={(e) => setState(e.target.value)} />
        <input type="number" placeholder="Min reliability" className="input w-32" value={minReliability} onChange={(e) => setMinReliability(e.target.value)} />
        {(trade || state || q || minReliability) && (
          <button className="btn-ghost text-xs" onClick={() => { setTrade(""); setState(""); setQ(""); setMinReliability(""); }}>Clear</button>
        )}
      </div>
      <div className="scroll-thin flex-1 overflow-auto p-4">
        <div className="card overflow-hidden p-0">
          <table className="w-full border-collapse">
            <thead className="border-b border-ink-800 bg-ink-900/60">
              <tr>
                <th className="th w-8"></th>
                <th className="th">Company</th>
                <th className="th">Trades</th>
                <th className="th">Location</th>
                <th className="th">Rating</th>
                <th className="th">Reliability</th>
                <th className="th">License</th>
                <th className="th">Flags</th>
              </tr>
            </thead>
            <tbody>
              {(subs as Subcontractor[]).map((s) => (
                <tr key={s.id} className="border-b border-ink-800/40 last:border-0 hover:bg-ink-800/30">
                  <td className="td text-slate-500">{s.is_preferred ? "⭐" : ""}</td>
                  <td className="td">
                    <Link href={`/subs/${s.id}`} className="font-medium text-slate-100 hover:text-brand-400">
                      {s.company_name}
                    </Link>
                    {s.owner_name && <p className="text-xs text-slate-500">{s.owner_name}</p>}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {s.trade_categories.slice(0, 2).map((t) => (
                        <span key={t} className="badge bg-ink-700 text-slate-300">{t}</span>
                      ))}
                      {s.trade_categories.length > 2 && <span className="text-xs text-slate-500">+{s.trade_categories.length - 2}</span>}
                    </div>
                  </td>
                  <td className="td text-slate-400">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="td font-mono">{s.google_rating != null ? `${s.google_rating}★ (${s.review_count ?? 0})` : "—"}</td>
                  <td className="td font-mono">{s.reliability_score != null ? `${Math.round(s.reliability_score)}%` : "—"}</td>
                  <td className="td">
                    {s.license_number ? (
                      <span className={`badge ${s.license_status === "active" ? "bg-pursue/15 text-pursue" : "bg-review/15 text-review"}`}>
                        {s.license_status ?? "unknown"}
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      {s.sam_excluded && <span className="badge bg-risk/15 text-risk">SAM excl.</span>}
                      {s.sb_certified && <span className="badge bg-brand-600/15 text-brand-400">SB</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && subs.length === 0 && (
                <tr><td colSpan={8} className="td py-8 text-center text-slate-500">No subcontractors found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
