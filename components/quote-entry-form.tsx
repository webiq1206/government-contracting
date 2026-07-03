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
      router.refresh();
    } else {
      setError(data.error ?? "Failed to save quotes.");
    }
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            className="input"
            placeholder="Trade"
            value={row.trade}
            onChange={(e) => update(i, { trade: e.target.value })}
            list="trades"
          />
          <select
            className="input"
            value={row.subcontractorId}
            onChange={(e) => update(i, { subcontractorId: e.target.value })}
          >
            <option value="">Sub (optional)</option>
            {subs.map((s) => (
              <option key={s.subcontractor_id} value={s.subcontractor_id}>
                {s.company_name}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            placeholder="Quote amount"
            value={row.quote_amount}
            onChange={(e) => update(i, { quote_amount: e.target.value })}
          />
          <input
            className="input"
            placeholder="Payment terms"
            value={row.payment_terms}
            onChange={(e) => update(i, { payment_terms: e.target.value })}
          />
        </div>
      ))}
      {error && <p className="text-sm text-risk">{error}</p>}
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
