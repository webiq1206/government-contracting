import { useRoute, Link } from "wouter";
import { useState } from "react";
import { useGetSub } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { currency, shortDate, timeAgo } from "@/lib/format";
import type { Subcontractor, ProjectHistoryItem, SubQuote, ExtraFields } from "@/lib/types";

interface ContactDraft {
  company_name: string;
  owner_name: string;
  phone: string;
  email: string;
  website: string;
  city: string;
  state: string;
}

async function fetchSubQuotes(subId: string): Promise<SubQuote[]> {
  const res = await fetch(`/api/subs/${subId}/quotes`, { credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

const EXTRA_FIELD_DEFS: { key: keyof ExtraFields; label: string; type: string; placeholder?: string }[] = [
  { key: "years_experience", label: "Years in business", type: "number", placeholder: "e.g. 12" },
  { key: "crew_size", label: "Crew size", type: "number", placeholder: "e.g. 8" },
  { key: "bonding_capacity", label: "Bonding capacity ($)", type: "number", placeholder: "e.g. 500000" },
  { key: "insurance_status", label: "Insurance status", type: "text", placeholder: "e.g. Active – GL + WC" },
  { key: "insurance_expiry", label: "Insurance expiry date", type: "date" },
  { key: "certifications", label: "Certifications", type: "text", placeholder: "e.g. MBE, DBE, LEED AP" },
  { key: "service_areas", label: "Service areas", type: "text", placeholder: "e.g. SoCal, AZ, NV" },
  { key: "availability", label: "Availability", type: "text", placeholder: "e.g. Available Q3 2026" },
  { key: "preferred_project_size", label: "Preferred project size", type: "text", placeholder: "e.g. $100K–$2M" },
  { key: "preferred_communication", label: "Preferred contact method", type: "text", placeholder: "e.g. Call / Text / Email" },
];

export default function SubDetailPage() {
  const [, params] = useRoute("/subs/:id");
  const id = params?.id ?? "";
  const { data: sub, isLoading, refetch } = useGetSub(id);
  const [editingHistory, setEditingHistory] = useState(false);
  const [historyJson, setHistoryJson] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [contact, setContact] = useState<ContactDraft | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [contactError, setContactError] = useState("");
  const [extraDraft, setExtraDraft] = useState<ExtraFields | null>(null);
  const [savingExtra, setSavingExtra] = useState(false);
  const [editingQuoteCard, setEditingQuoteCard] = useState<string | null>(null);
  const [editQuoteAmount, setEditQuoteAmount] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);
  const qc = useQueryClient();

  const { data: quotes = [] } = useQuery({
    queryKey: ["sub-quotes", id],
    queryFn: () => fetchSubQuotes(id),
    enabled: !!id,
  });

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
  const extra: ExtraFields = extraDraft ?? (s.extra_fields ?? {});

  function initContactEdit() {
    setContact({
      company_name: s.company_name ?? "",
      owner_name: s.owner_name ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      website: s.website ?? "",
      city: s.city ?? "",
      state: s.state ?? "",
    });
    setContactError("");
    setEditingContact(true);
  }

  function setField(field: keyof ContactDraft, value: string) {
    setContact((prev) => prev ? { ...prev, [field]: value } : prev);
  }

  async function saveContact() {
    if (!contact) return;
    setSavingContact(true);
    setContactError("");
    try {
      const res = await fetch(`/api/subs/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: contact.company_name || null,
          owner_name: contact.owner_name || null,
          phone: contact.phone || null,
          email: contact.email || null,
          website: contact.website || null,
          city: contact.city || null,
          state: contact.state || null,
        }),
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setContactError((body as Record<string, unknown>).error as string ?? "Save failed");
      } else {
        setEditingContact(false);
        refetch();
      }
    } catch (e) {
      setContactError((e as Error).message);
    } finally {
      setSavingContact(false);
    }
  }

  function initHistoryEdit() {
    setHistoryJson(JSON.stringify(history, null, 2));
    setEditingHistory(true);
  }

  function setExtraField(key: keyof ExtraFields, value: unknown) {
    setExtraDraft((prev) => ({ ...(prev ?? s.extra_fields ?? {}), [key]: value === "" ? null : value }));
  }

  async function saveQuote(cardId: string) {
    setSavingQuote(true);
    try {
      await fetch(`/api/call-cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_amount: editQuoteAmount ? Number(editQuoteAmount) : null }),
        credentials: "include",
      });
      qc.invalidateQueries({ queryKey: ["sub-quotes", id] });
      qc.invalidateQueries({ queryKey: ["getOpportunity"] });
      setEditingQuoteCard(null);
    } finally {
      setSavingQuote(false);
    }
  }

  async function saveExtraFields() {
    setSavingExtra(true);
    try {
      await fetch(`/api/subs/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extra_fields: extra }),
        credentials: "include",
      });
      refetch();
      setExtraDraft(null);
    } finally {
      setSavingExtra(false);
    }
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

        {/* ── Contact Info ── */}
        {!editingContact ? (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="label">Contact info</p>
              <button className="btn-ghost text-xs" onClick={initContactEdit}>Edit</button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><p className="label">Phone</p><p className="mt-0.5 text-sm text-slate-200">{s.phone ? <a href={`tel:${s.phone}`} className="text-brand-400 hover:underline">{s.phone}</a> : <span className="text-slate-500">—</span>}</p></div>
              <div><p className="label">Email</p><p className="mt-0.5 truncate text-sm text-slate-200">{s.email ? <a href={`mailto:${s.email}`} className="text-brand-400 hover:underline">{s.email}</a> : <span className="text-slate-500">—</span>}{s.email_verified && <span className="ml-1 text-xs text-pursue">✓</span>}</p></div>
              <div><p className="label">Location</p><p className="mt-0.5 text-sm text-slate-200">{[s.city, s.state].filter(Boolean).join(", ") || <span className="text-slate-500">—</span>}</p></div>
              <div><p className="label">Website</p><p className="mt-0.5 truncate text-sm">{s.website ? <a href={s.website} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">{s.website}</a> : <span className="text-slate-500">—</span>}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div><p className="label">Company name</p><p className="mt-0.5 text-sm text-slate-200">{s.company_name || <span className="text-slate-500">—</span>}</p></div>
              <div><p className="label">Contact / Owner</p><p className="mt-0.5 text-sm text-slate-200">{s.owner_name || <span className="text-slate-500">—</span>}</p></div>
              <div><p className="label">Last contact</p><p className="mt-0.5 text-sm text-slate-200">{s.last_contacted ? timeAgo(s.last_contacted) : "—"}</p></div>
            </div>
          </div>
        ) : (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <p className="label">Edit contact info</p>
              <button className="btn-ghost text-xs" onClick={() => setEditingContact(false)}>Cancel</button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label mb-1">Company name</label>
                <input className="input" value={contact?.company_name ?? ""} onChange={(e) => setField("company_name", e.target.value)} placeholder="Company name" />
              </div>
              <div>
                <label className="label mb-1">Contact / Owner name</label>
                <input className="input" value={contact?.owner_name ?? ""} onChange={(e) => setField("owner_name", e.target.value)} placeholder="Owner or primary contact" />
              </div>
              <div>
                <label className="label mb-1">Phone</label>
                <input className="input" type="tel" value={contact?.phone ?? ""} onChange={(e) => setField("phone", e.target.value)} placeholder="(555) 555-5555" />
              </div>
              <div>
                <label className="label mb-1">Email</label>
                <input className="input" type="email" value={contact?.email ?? ""} onChange={(e) => setField("email", e.target.value)} placeholder="contact@company.com" />
              </div>
              <div>
                <label className="label mb-1">Website</label>
                <input className="input" type="url" value={contact?.website ?? ""} onChange={(e) => setField("website", e.target.value)} placeholder="https://..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label mb-1">City</label>
                  <input className="input" value={contact?.city ?? ""} onChange={(e) => setField("city", e.target.value)} placeholder="City" />
                </div>
                <div>
                  <label className="label mb-1">State</label>
                  <input className="input" value={contact?.state ?? ""} onChange={(e) => setField("state", e.target.value)} placeholder="CA" maxLength={2} />
                </div>
              </div>
            </div>
            {contactError && <p className="text-sm text-risk">{contactError}</p>}
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveContact} disabled={savingContact}>
                {savingContact ? "Saving..." : "Save contact info"}
              </button>
              <button className="btn-ghost" onClick={() => setEditingContact(false)}>Cancel</button>
            </div>
          </div>
        )}

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

        {/* ── Quotes on file ── */}
        {(quotes as SubQuote[]).length > 0 && (
          <div>
            <p className="label mb-2">Quotes on file</p>
            <div className="card overflow-hidden p-0">
              <table className="w-full border-collapse">
                <thead className="border-b border-ink-800 bg-ink-900/60">
                  <tr>
                    <th className="th">Opportunity</th>
                    <th className="th">Quote</th>
                    <th className="th">Date</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {(quotes as SubQuote[]).map((q) => {
                    const isEditing = editingQuoteCard === q.card_id;
                    return (
                      <tr key={q.card_id} className="border-b border-ink-800/40 last:border-0">
                        <td className="td">
                          <a href={`/opportunity/${q.opportunity_id}`} className="text-sm text-brand-400 hover:underline line-clamp-1">
                            {q.opportunity_title ?? "Untitled"}
                          </a>
                          <p className="text-xs text-slate-500">{q.stage?.replace(/_/g, " ")}</p>
                        </td>
                        <td className="td">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <span className="text-slate-400 text-sm">$</span>
                              <input
                                type="number"
                                className="input w-28 py-1 text-sm"
                                value={editQuoteAmount}
                                onChange={(e) => setEditQuoteAmount(e.target.value)}
                                autoFocus
                              />
                            </div>
                          ) : (
                            <span className="font-mono text-sm text-pursue">{currency(q.quote_amount)}</span>
                          )}
                        </td>
                        <td className="td text-sm text-slate-400">{q.called_at ? shortDate(q.called_at) : "—"}</td>
                        <td className="td">
                          {isEditing ? (
                            <div className="flex gap-1">
                              <button className="btn-primary py-1 text-xs" onClick={() => saveQuote(q.card_id)} disabled={savingQuote}>
                                {savingQuote ? "…" : "Save"}
                              </button>
                              <button className="btn-ghost py-1 text-xs" onClick={() => setEditingQuoteCard(null)}>Cancel</button>
                            </div>
                          ) : (
                            <button
                              className="btn-ghost py-1 text-xs"
                              onClick={() => { setEditingQuoteCard(q.card_id); setEditQuoteAmount(String(q.quote_amount)); }}
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Additional Info (extra_fields) ── */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <p className="label">Additional info</p>
            {extraDraft && <span className="text-xs text-review">Unsaved changes</span>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {EXTRA_FIELD_DEFS.map(({ key, label, type, placeholder }) => {
              const val = extra[key];
              const strVal = val != null ? String(val) : "";
              return (
                <div key={String(key)}>
                  <label className="label mb-1">{label}</label>
                  <input
                    className="input"
                    type={type}
                    placeholder={placeholder}
                    value={strVal}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setExtraField(key, type === "number" && raw !== "" ? Number(raw) : raw);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <button className="btn-primary" onClick={saveExtraFields} disabled={savingExtra}>
            {savingExtra ? "Saving..." : "Save additional info"}
          </button>
        </div>

        {/* ── Project history ── */}
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
