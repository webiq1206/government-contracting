import { useRoute, Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { useGetOpportunity } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, ScoreBadge, TierBadge } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { currency, countdown, shortDate, pct } from "@/lib/format";
import type { Opportunity, ScoreBreakdown, OppSubQuote } from "@/lib/types";

const STAGE_STEPS = [
  "monitoring", "scoring", "analysis", "sub_research", "outreach",
  "call_queue", "quote_entry", "bid_building", "submitted",
];

function StageProgress({ stage }: { stage: string }) {
  const idx = STAGE_STEPS.indexOf(stage);
  if (idx < 0) return null;
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STAGE_STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={`h-2 w-2 shrink-0 rounded-full ${i < idx ? "bg-pursue" : i === idx ? "bg-brand-400" : "bg-ink-700"}`} />
          {i < STAGE_STEPS.length - 1 && <div className={`h-0.5 w-4 shrink-0 ${i < idx ? "bg-pursue/50" : "bg-ink-700"}`} />}
        </div>
      ))}
    </div>
  );
}

interface SubOption { id: string; company_name: string; phone: string | null; }

async function fetchSubQuotes(oppId: string): Promise<OppSubQuote[]> {
  const res = await fetch(`/api/opportunities/${oppId}/quotes`, { credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

async function searchSubs(q: string): Promise<SubOption[]> {
  const res = await fetch(`/api/subs?q=${encodeURIComponent(q)}&limit=20`, { credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

function AddQuoteModal({ oppId, onClose, onSaved }: { oppId: string; onClose: () => void; onSaved: () => void }) {
  const [subSearch, setSubSearch] = useState("");
  const [subOptions, setSubOptions] = useState<SubOption[]>([]);
  const [selectedSub, setSelectedSub] = useState<SubOption | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (subSearch.length < 2) { setSubOptions([]); return; }
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(async () => {
      const results = await searchSubs(subSearch);
      setSubOptions(results);
    }, 250);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [subSearch]);

  async function handleSave() {
    if (!selectedSub) { setError("Select a subcontractor"); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { setError("Enter a valid amount"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${oppId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subcontractor_id: selectedSub.id, quote_amount: Number(amount) }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Save failed");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-100">Add quote</p>
          <button className="text-slate-500 hover:text-slate-300 text-lg leading-none" onClick={onClose}>✕</button>
        </div>

        <div className="space-y-1">
          <label className="label">Subcontractor</label>
          {selectedSub ? (
            <div className="flex items-center justify-between rounded-md border border-ink-700 bg-ink-900 px-3 py-2">
              <span className="text-sm text-slate-100">{selectedSub.company_name}</span>
              <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => { setSelectedSub(null); setSubSearch(""); setSubOptions([]); }}>change</button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                className="input w-full"
                placeholder="Search by name…"
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                autoFocus
              />
              {subOptions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-md border border-ink-700 bg-ink-900 shadow-lg overflow-hidden">
                  {subOptions.map((s) => (
                    <button
                      key={s.id}
                      className="w-full px-3 py-2 text-left hover:bg-ink-800 border-b border-ink-800/50 last:border-0"
                      onClick={() => { setSelectedSub(s); setSubSearch(""); setSubOptions([]); }}
                    >
                      <p className="text-sm text-slate-100">{s.company_name}</p>
                      {s.phone && <p className="text-xs text-slate-500">{s.phone}</p>}
                    </button>
                  ))}
                </div>
              )}
              {subSearch.length >= 2 && subOptions.length === 0 && (
                <p className="mt-1 text-xs text-slate-500">No matches found</p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="label">Quote amount</label>
          <div className="flex items-center gap-1">
            <span className="text-slate-400 text-sm">$</span>
            <input
              type="number"
              className="input flex-1"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
            />
          </div>
        </div>

        {error && <p className="text-xs text-risk">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save quote"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SubQuotesSection({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["opp-quotes", oppId],
    queryFn: () => fetchSubQuotes(oppId),
  });

  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  async function saveQuote(cardId: string) {
    setSaving(true);
    try {
      await fetch(`/api/call-cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_amount: editAmount ? Number(editAmount) : null }),
        credentials: "include",
      });
      qc.invalidateQueries({ queryKey: ["opp-quotes", oppId] });
      qc.invalidateQueries({ queryKey: ["getOpportunity", oppId] });
      setEditingCard(null);
    } finally {
      setSaving(false);
    }
  }

  function handleQuoteSaved() {
    setShowAddModal(false);
    qc.invalidateQueries({ queryKey: ["opp-quotes", oppId] });
    qc.invalidateQueries({ queryKey: ["getOpportunity", oppId] });
  }

  if (isLoading) return null;

  const hasQuotes = quotes.some((q) => q.quote_amount != null);
  const quoted = quotes.filter((q) => q.quote_amount != null).sort((a, b) => (a.quote_amount ?? 0) - (b.quote_amount ?? 0));
  const noQuote = quotes.filter((q) => q.quote_amount == null);

  const allSubs = [...quoted, ...noQuote];

  const minQ = quoted.length > 0 ? Math.min(...quoted.map((q) => q.quote_amount ?? Infinity)) : null;
  const maxQ = quoted.length > 0 ? Math.max(...quoted.map((q) => q.quote_amount ?? -Infinity)) : null;

  return (
    <div>
      {showAddModal && (
        <AddQuoteModal
          oppId={oppId}
          onClose={() => setShowAddModal(false)}
          onSaved={handleQuoteSaved}
        />
      )}
      <div className="flex items-center justify-between mb-2">
        <p className="label">Sub quotes ({quoted.length} received)</p>
        <div className="flex items-center gap-3">
          {hasQuotes && minQ != null && maxQ != null && (
            <span className="text-xs text-slate-400 font-mono">
              Range: {currency(minQ)} – {currency(maxQ)}
            </span>
          )}
          <button className="btn-ghost py-1 text-xs" onClick={() => setShowAddModal(true)}>
            + Add quote
          </button>
        </div>
      </div>
      {allSubs.length === 0 ? (
        <p className="text-xs text-slate-500">No call cards yet. Use "Add quote" to record a sub's number directly.</p>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full border-collapse">
            <thead className="border-b border-ink-800 bg-ink-900/60">
              <tr>
                <th className="th">Subcontractor</th>
                <th className="th">Quote amount</th>
                <th className="th">Status</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {allSubs.map((q) => {
                const isEditing = editingCard === q.card_id;
                const outcome = (q.response_json as Record<string, unknown> | null)?.outcome as string | undefined;
                return (
                  <tr key={q.card_id} className="border-b border-ink-800/40 last:border-0">
                    <td className="td">
                      <p className="text-sm text-slate-100">{q.company_name}</p>
                      {q.phone && <p className="text-xs text-slate-500">{q.phone}</p>}
                    </td>
                    <td className="td">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 text-sm">$</span>
                          <input
                            type="number"
                            className="input w-28 py-1 text-sm"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <span className={`font-mono text-sm ${q.quote_amount != null ? (q.quote_amount === minQ ? "text-pursue font-semibold" : "text-slate-200") : "text-slate-500"}`}>
                          {q.quote_amount != null ? currency(q.quote_amount) : "—"}
                        </span>
                      )}
                    </td>
                    <td className="td">
                      {outcome ? (
                        <span className={`badge text-xs ${outcome === "quoted" ? "bg-pursue/15 text-pursue" : outcome === "not_interested" ? "bg-risk/15 text-risk" : "bg-ink-700 text-slate-400"}`}>
                          {outcome.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="badge bg-review/15 text-review text-xs">pending</span>
                      )}
                    </td>
                    <td className="td">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button className="btn-primary py-1 text-xs" onClick={() => saveQuote(q.card_id)} disabled={saving}>
                            {saving ? "…" : "Save"}
                          </button>
                          <button className="btn-ghost py-1 text-xs" onClick={() => setEditingCard(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button
                          className="btn-ghost py-1 text-xs"
                          onClick={() => { setEditingCard(q.card_id); setEditAmount(q.quote_amount != null ? String(q.quote_amount) : ""); }}
                        >
                          {q.quote_amount != null ? "Edit" : "Add quote"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function OpportunityDetailPage() {
  const [, params] = useRoute("/opportunity/:id");
  const id = params?.id ?? "";
  const { data: opp, isLoading } = useGetOpportunity(id);

  if (isLoading) return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-800 px-5 py-4">
        <Link href="/pipeline" className="text-sm text-slate-400 hover:text-brand-400">← Pipeline</Link>
      </div>
      <p className="p-6 text-sm text-slate-400">Loading...</p>
    </div>
  );

  if (!opp) return (
    <div className="p-6">
      <Link href="/pipeline" className="text-sm text-slate-400">← Back to pipeline</Link>
      <p className="mt-4 text-sm text-slate-400">Opportunity not found.</p>
    </div>
  );

  const o = opp as Opportunity;
  const scoreBreakdown = o.score_breakdown as ScoreBreakdown | null;
  const dims = scoreBreakdown?.dimensions ?? [];
  const exp = countdown(o.deadline);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-800 px-5 py-3">
        <Link href="/pipeline" className="text-sm text-slate-400 hover:text-brand-400">← Pipeline</Link>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">{o.title ?? "Untitled Opportunity"}</h1>
            <p className="mt-1 text-sm text-slate-400">{o.agency ?? "—"}{o.sub_agency ? ` · ${o.sub_agency}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <ScoreBadge score={o.score} />
            <TierBadge tier={o.tier} />
          </div>
        </div>

        <div>
          <p className="label mb-1">Pipeline stage</p>
          <StageProgress stage={o.stage} />
          <p className="mt-1 font-mono text-xs text-slate-500">{o.stage}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><p className="label">Est. value</p><p className="mt-0.5 text-lg font-semibold text-white">{currency(o.value_estimated)}</p></div>
          <div><p className="label">Deadline</p><p className={`mt-0.5 text-lg font-semibold ${exp === "overdue" ? "text-risk" : "text-white"}`}>⏱ {exp}</p></div>
          <div><p className="label">NAICS</p><p className="mt-0.5 text-sm text-slate-200">{o.naics_code ?? "—"}</p></div>
          <div><p className="label">Set-aside</p><p className="mt-0.5 text-sm text-slate-200">{o.set_aside_type ?? "Full open"}</p></div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div><p className="label">Location</p><p className="mt-0.5 text-sm text-slate-200">{o.location_text ?? o.location_state ?? "—"}</p></div>
          <div><p className="label">Source</p><p className="mt-0.5 text-sm text-slate-200">{o.source}</p></div>
          <div><p className="label">Posted</p><p className="mt-0.5 text-sm text-slate-200">{shortDate(o.posted_at)}</p></div>
        </div>

        {o.solicitation_number && (
          <div>
            <p className="label">Solicitation #</p>
            <p className="mt-0.5 font-mono text-sm text-slate-200">{o.solicitation_number}</p>
          </div>
        )}

        {o.description && (
          <div>
            <p className="label mb-1">Description</p>
            <div className="card bg-ink-950/60">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{o.description}</p>
            </div>
          </div>
        )}

        {/* Bid summary — sourced from enriched GET /:id response */}
        {(o.bid_quote_count ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="label">Quotes received</p><p className="mt-0.5 font-mono text-sm text-slate-200">{o.bid_quote_count}</p></div>
            <div><p className="label">Low bid</p><p className="mt-0.5 font-mono text-sm text-pursue">{o.bid_min_quote != null ? currency(o.bid_min_quote) : "—"}</p></div>
            <div><p className="label">High bid</p><p className="mt-0.5 font-mono text-sm text-slate-200">{o.bid_max_quote != null ? currency(o.bid_max_quote) : "—"}</p></div>
            <div><p className="label">Avg bid</p><p className="mt-0.5 font-mono text-sm text-slate-400">{o.bid_avg_quote != null ? currency(o.bid_avg_quote) : "—"}</p></div>
          </div>
        )}

        {/* Sub quotes — individual entries with inline editing */}
        <SubQuotesSection oppId={o.id} />

        {dims.length > 0 && (
          <div>
            <p className="label mb-2">Score breakdown</p>
            <div className="card space-y-3">
              {scoreBreakdown?.summary && <p className="text-sm text-slate-300">{scoreBreakdown.summary}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {dims.map((d) => {
                  const ratio = d.max_points > 0 ? Math.min(1, Math.max(0, d.points / d.max_points)) : 0;
                  const bar = ratio >= 0.75 ? "bg-pursue" : ratio >= 0.4 ? "bg-review" : "bg-risk";
                  return (
                    <div key={d.key}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">{d.label}</span>
                        <span className="font-mono text-slate-300">{d.points}/{d.max_points}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
                        <div className={`h-full rounded-full ${bar}`} style={{ width: `${ratio * 100}%` }} />
                      </div>
                      {d.reasoning && <p className="mt-0.5 text-xs text-slate-500">{d.reasoning}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {o.risk_flags && o.risk_flags.length > 0 && (
          <div>
            <p className="label mb-1">Risk flags</p>
            <div className="flex flex-wrap gap-2">
              {o.risk_flags.map((f, i) => <span key={i} className="badge bg-risk/15 text-risk">⚠ {f}</span>)}
            </div>
          </div>
        )}

        {o.human_action_required && (
          <div className="card border-review/40 bg-review/5">
            <p className="text-sm font-semibold text-review">⚑ Decision required</p>
            <p className="mt-1 text-xs text-slate-400">This opportunity is in the review tier. Pursue or dismiss it below.</p>
            <div className="mt-3 flex items-center gap-2">
              <ActionButton endpoint={`/api/opportunities/${o.id}/action`} body={{ action: "pursue" }} className="btn-success" invalidateKeys={[["getOpportunity", o.id]]}>Pursue</ActionButton>
              <ActionButton endpoint={`/api/opportunities/${o.id}/action`} body={{ action: "dismiss" }} className="btn-danger" confirm="Dismiss this opportunity?" invalidateKeys={[["getOpportunity", o.id]]}>Dismiss</ActionButton>
            </div>
          </div>
        )}

        {!["dismissed", "won", "lost"].includes(o.stage) && !o.human_action_required && (
          <div>
            <p className="label mb-2">Advance stage manually</p>
            <div className="flex flex-wrap gap-2">
              {STAGE_STEPS.slice(STAGE_STEPS.indexOf(o.stage) + 1).map((s) => (
                <ActionButton key={s} endpoint={`/api/opportunities/${o.id}/action`} body={{ action: "advance", stage: s }} className="btn-ghost" invalidateKeys={[["getOpportunity", o.id]]}>
                  → {s.replaceAll("_", " ")}
                </ActionButton>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
