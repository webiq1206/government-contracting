import { useRoute, Link } from "wouter";
import { useState } from "react";
import { useGetSub } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { currency, shortDate, timeAgo } from "@/lib/format";
import type { Subcontractor, ProjectHistoryItem } from "@/lib/types";

export default function SubDetailPage() {
  const [, params] = useRoute("/subs/:id");
  const id = params?.id ?? "";
  const { data: sub, isLoading } = useGetSub(id);
  const [editingHistory, setEditingHistory] = useState(false);
  const [historyJson, setHistoryJson] = useState("");
  const [notes, setNotes] = useState<string | null>(null);

  if (isLoading) return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-800 px-5 py-4">
        <Link href="/subs" className="text-sm text-slate-400 hover:text-brand-400">← Subs</Link>
      </div>
      <p className="p-6 text-sm text-slate-400">Loading...</p>
    </div>
  );

  if (!sub) return (
    <div className="p-6">
      <Link href="/subs" className="text-sm text-slate-400">← Back to subs</Link>
      <p className="mt-4 text-sm text-slate-400">Subcontractor not found.</p>
    </div>
  );

  const s = sub as Subcontractor;
  const history = s.project_history ?? [];
  const currentNotes = notes ?? s.notes ?? "";

  function initHistoryEdit() {
    setHistoryJson(JSON.stringify(history, null, 2));
    setEditingHistory(true);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-800 px-5 py-3">
        <Link href="/subs" className="text-sm text-slate-400 hover:text-brand-400">← Sub Database</Link>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">{s.company_name}</h1>
            {s.owner_name && <p className="mt-0.5 text-sm text-slate-400">{s.owner_name}</p>}
          </div>
          <div className="flex items-center gap-2">
            {s.is_preferred && <span className="badge bg-brand-600/15 text-brand-400">⭐ Preferred</span>}
            {s.blacklisted && <span className="badge bg-risk/20 text-risk">Blacklisted</span>}
            {s.sb_certified && <span className="badge bg-pursue/15 text-pursue">SB Certified</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="label">Phone</p><p className="mt-0.5 text-sm text-slate-200">{s.phone ? <a href={`tel:${s.phone}`} className="text-brand-400 hover:underline">{s.phone}</a> : "—"}</p></div>
          <div><p className="label">Email</p><p className="mt-0.5 truncate text-sm text-slate-200">{s.email ? <a href={`mailto:${s.email}`} className="text-brand-400 hover:underline">{s.email}</a> : "—"}{s.email_verified && <span className="ml-1 text-xs text-pursue">✓</span>}</p></div>
          <div><p className="label">Location</p><p className="mt-0.5 text-sm text-slate-200">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</p></div>
          <div><p className="label">Website</p><p className="mt-0.5 truncate text-sm">{s.website ? <a href={s.website} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">{s.website}</a> : "—"}</p></div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="label">Google rating</p><p className="mt-0.5 font-mono text-sm text-slate-200">{s.google_rating != null ? `${s.google_rating}★ (${s.review_count ?? 0})` : "—"}</p></div>
          <div><p className="label">Reliability</p><p className="mt-0.5 font-mono text-sm text-slate-200">{s.reliability_score != null ? `${Math.round(s.reliability_score)}%` : "—"}</p></div>
          <div><p className="label">Responsiveness</p><p className="mt-0.5 font-mono text-sm text-slate-200">{s.responsiveness_score != null ? `${Math.round(s.responsiveness_score)}%` : "—"}</p></div>
          <div><p className="label">Business age</p><p className="mt-0.5 text-sm text-slate-200">{s.business_age_years != null ? `${s.business_age_years} yr` : "—"}</p></div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="label">License</p>
            {s.license_number ? (
              <p className="mt-0.5 text-sm text-slate-200">{s.license_number} — <span className={s.license_status === "active" ? "text-pursue" : "text-review"}>{s.license_status ?? "unknown"}</span></p>
            ) : <p className="mt-0.5 text-sm text-slate-500">Not on file</p>}
          </div>
          <div>
            <p className="label">SAM status</p>
            <p className={`mt-0.5 text-sm ${s.sam_excluded ? "text-risk" : "text-slate-200"}`}>{s.sam_excluded ? "⚠ SAM Excluded" : "Active / not excluded"}</p>
          </div>
          <div><p className="label">Last contact</p><p className="mt-0.5 text-sm text-slate-200">{s.last_contacted ? timeAgo(s.last_contacted) : "—"}</p></div>
        </div>

        {s.trade_categories.length > 0 && (
          <div>
            <p className="label mb-1">Trades</p>
            <div className="flex flex-wrap gap-1.5">
              {s.trade_categories.map((t) => <span key={t} className="badge bg-ink-700 text-slate-300">{t}</span>)}
            </div>
          </div>
        )}

        {s.naics_codes.length > 0 && (
          <div>
            <p className="label mb-1">NAICS codes</p>
            <div className="flex flex-wrap gap-1.5">
              {s.naics_codes.map((n) => <span key={n} className="badge bg-ink-800 font-mono text-slate-400">{n}</span>)}
            </div>
          </div>
        )}

        {(s.reviews_summary || s.bbb_summary) && (
          <div className="space-y-2">
            {s.reviews_summary && (
              <div className="card bg-ink-950/60">
                <p className="label mb-1">Review summary (AI)</p>
                <p className="text-sm text-slate-300">{s.reviews_summary}</p>
              </div>
            )}
            {s.bbb_summary && (
              <div className="card bg-ink-950/60">
                <p className="label mb-1">BBB summary</p>
                <p className="text-sm text-slate-300">{s.bbb_summary}</p>
              </div>
            )}
          </div>
        )}

        <div>
          <p className="label mb-1">Project history</p>
          {!editingHistory ? (
            <>
              {history.length > 0 ? (
                <div className="card overflow-hidden p-0">
                  <table className="w-full border-collapse">
                    <thead className="border-b border-ink-800 bg-ink-900/60">
                      <tr>
                        <th className="th">Project</th>
                        <th className="th">Client type</th>
                        <th className="th">Value</th>
                        <th className="th">Year</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h: ProjectHistoryItem, i: number) => (
                        <tr key={i} className="border-b border-ink-800/40 last:border-0">
                          <td className="td">
                            <p className="text-sm text-slate-100">{h.name ?? "—"}</p>
                            {h.scope && <p className="text-xs text-slate-500">{h.scope}</p>}
                          </td>
                          <td className="td text-sm text-slate-400">{h.client_type ?? "—"}</td>
                          <td className="td font-mono text-sm">{h.value != null ? currency(h.value) : "—"}</td>
                          <td className="td text-sm text-slate-400">{h.year ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-slate-500">No project history on file.</p>}
              <button className="btn-ghost mt-2 text-xs" onClick={initHistoryEdit}>Edit JSON</button>
            </>
          ) : (
            <div className="space-y-2">
              <textarea className="input h-48 font-mono text-xs" value={historyJson} onChange={(e) => setHistoryJson(e.target.value)} />
              <div className="flex gap-2">
                <ActionButton
                  endpoint={`/api/subs/${s.id}`}
                  method="PATCH"
                  body={{ project_history: (() => { try { return JSON.parse(historyJson); } catch { return null; } })() }}
                  className="btn-primary"
                  invalidateKeys={[["getSub", s.id]]}
                  onDone={() => setEditingHistory(false)}
                >Save</ActionButton>
                <button className="btn-ghost" onClick={() => setEditingHistory(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="label mb-1">Notes</p>
          <textarea
            className="input w-full"
            rows={3}
            value={currentNotes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add internal notes..."
          />
          <ActionButton
            endpoint={`/api/subs/${s.id}`}
            method="PATCH"
            body={{ notes: currentNotes }}
            className="btn-ghost mt-2"
            invalidateKeys={[["getSub", s.id]]}
          >Save notes</ActionButton>
        </div>

        <div className="flex gap-2 border-t border-ink-800 pt-3">
          <ActionButton
            endpoint={`/api/subs/${s.id}`}
            method="PATCH"
            body={{ is_preferred: !s.is_preferred }}
            className="btn-ghost"
            invalidateKeys={[["getSub", s.id]]}
          >{s.is_preferred ? "Remove preferred" : "⭐ Mark preferred"}</ActionButton>
          <ActionButton
            endpoint={`/api/subs/${s.id}`}
            method="PATCH"
            body={{ blacklisted: !s.blacklisted }}
            className={s.blacklisted ? "btn-ghost" : "btn-danger"}
            confirm={s.blacklisted ? undefined : "Blacklist this subcontractor? They will be excluded from future searches."}
            invalidateKeys={[["getSub", s.id]]}
          >{s.blacklisted ? "Remove blacklist" : "Blacklist"}</ActionButton>
        </div>
      </div>
    </div>
  );
}
