"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Row {
  trade: string;
  subcontractorId: string;
  quote_amount: string;
  payment_terms: string;
}

interface SubOption {
  subcontractor_id: string;
  company_name: string;
  trade: string | null;
}

/** Enter one or more written sub quotes; posts to /api/opportunities/[id]/quote (triggers Bid Builder). */
export function QuoteEntryForm({
  opportunityId,
  subs,
}: {
  opportunityId: string;
  subs: SubOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([
    { trade: "", subcontractorId: "", quote_amount: "", payment_terms: "" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function update(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    const items = rows
      .filter((r) => Number(r.quote_amount) > 0)
      .map((r) => ({
        trade: r.trade || undefined,
        subcontractorId: r.subcontractorId || undefined,
        quote_amount: Number(r.quote_amount),
        payment_terms: r.payment_terms || undefined,
      }));
    if (items.length === 0) {
      setError("Enter at least one quote amount.");
      setLoading(false);
      return;
    }
    const res = await fetch(`/api/opportunities/${opportunityId}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const notes: string[] = [];
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        notes.push(...data.warnings);
      }
      if (Array.isArray(data.rejected) && data.rejected.length > 0) {
        notes.push(
          ...data.rejected.map(
            (r: { trade: string | null; reason: string }) =>
              `${r.trade ?? "One quote"} was not saved: ${r.reason}`
          )
        );
      }
      setNotice(
        notes.length > 0
          ? notes.join(" ")
          : `Saved ${data.saved ?? "your"} quote(s). Bid Builder is pricing the bid now.`
      );
      router.refresh();
    } else {
      setError(data.error ?? "Failed to save quotes.");
    }
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-700">Trade</span> is the type of
        work (e.g. HVAC, electrical, roofing).{" "}
        <span className="font-medium text-slate-700">Subcontractor</span> is the
        company giving you that price, pick one you&rsquo;ve already found, or
        leave it blank if you don&rsquo;t have them on file yet.
      </p>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <label className="block">
            <span className="label mb-1 block">Trade (type of work)</span>
            <input
              className="input w-full"
              placeholder="e.g. HVAC"
              value={row.trade}
              onChange={(e) => update(i, { trade: e.target.value })}
              list="trades"
            />
          </label>
          <label className="block">
            <span className="label mb-1 block">Subcontractor (optional)</span>
            <select
              className="input w-full"
              value={row.subcontractorId}
              onChange={(e) => update(i, { subcontractorId: e.target.value })}
            >
              <option value="">Not on file yet</option>
              {subs.map((s) => (
                <option key={s.subcontractor_id} value={s.subcontractor_id}>
                  {s.company_name}
                  {s.trade ? `, ${s.trade}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label mb-1 block">Their quote ($)</span>
            <input
              className="input w-full"
              type="number"
              placeholder="e.g. 42000"
              value={row.quote_amount}
              onChange={(e) => update(i, { quote_amount: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label mb-1 block">Payment terms</span>
            <input
              className="input w-full"
              placeholder="e.g. Net 30"
              value={row.payment_terms}
              onChange={(e) => update(i, { payment_terms: e.target.value })}
            />
          </label>
        </div>
      ))}
      {error && <p className="text-sm text-risk">{error}</p>}
      {notice && !error && <p className="text-sm text-accent">{notice}</p>}
      <div className="flex gap-2">
        <button
          className="btn-ghost"
          onClick={() =>
            setRows((r) => [...r, { trade: "", subcontractorId: "", quote_amount: "", payment_terms: "" }])
          }
        >
          + Add trade
        </button>
        <button className="btn-primary" onClick={submit} disabled={loading}>
          {loading ? "Saving..." : "Save quotes & build bid"}
        </button>
      </div>
    </div>
  );
}
