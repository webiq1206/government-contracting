"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Row {
  trade: string;
  subcontractorId: string;
  quote_amount: string;
  payment_terms: string;
  /** Operator chose "Other", so the trade is typed rather than picked. */
  custom: boolean;
}

const OTHER = "__other";

function emptyRow(trade = ""): Row {
  return {
    trade,
    subcontractorId: "",
    quote_amount: "",
    payment_terms: "",
    custom: false,
  };
}

interface SubOption {
  subcontractor_id: string;
  company_name: string;
  trade: string | null;
}

/**
 * Enter one or more written sub quotes; posts to /api/opportunities/[id]/quote
 * (triggers the Bid Builder). Laid out to breathe at full width: each quote is
 * its own labeled row of four fields. `layout="stacked"` collapses the fields
 * into a single column for narrow placements (e.g. beside a finished bid).
 */
export function QuoteEntryForm({
  opportunityId,
  subs,
  layout = "wide",
  onSaved,
  requiredTrades = [],
  quotedTrades = [],
}: {
  opportunityId: string;
  subs: SubOption[];
  layout?: "wide" | "stacked";
  /** Called after a successful save (Guide Me uses this to reevaluate). */
  onSaved?: () => void;
  /**
   * The trades this solicitation actually needs priced. When present the trade
   * field becomes a picker instead of a free-text box: coverage matches quotes
   * to required trades by their exact name, so a typed "HVAC" against a
   * required "Heating, ventilation and air conditioning" left the trade
   * looking unpriced forever, and on a two-trade job there was nothing telling
   * the operator which half of the work they were entering a price for.
   */
  requiredTrades?: string[];
  /** Required trades that already have a price, marked in the picker. */
  quotedTrades?: string[];
}) {
  const router = useRouter();
  const priced = new Set(quotedTrades.map((t) => t.trim().toLowerCase()));
  const firstUnpriced =
    requiredTrades.find((t) => !priced.has(t.trim().toLowerCase())) ?? "";
  // Open on the work that still needs a price, so the common case is one
  // glance and a number rather than a decision about what to call the trade.
  const [rows, setRows] = useState<Row[]>([emptyRow(firstUnpriced)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function update(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function removeRow(i: number) {
    setRows((r) => (r.length === 1 ? r : r.filter((_, idx) => idx !== i)));
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
      onSaved?.();
    } else {
      setError(data.error ?? "Failed to save quotes.");
    }
    setLoading(false);
  }

  const fieldGrid =
    layout === "stacked"
      ? "grid grid-cols-1 gap-3"
      : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.4fr_1fr_1fr_auto] lg:items-end";

  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <div
          key={i}
          className={
            layout === "wide" && rows.length > 1
              ? "rounded-md border border-border bg-surface/50 p-3"
              : ""
          }
        >
          {layout === "wide" && rows.length > 1 && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Quote {i + 1}
            </p>
          )}
          <div className={fieldGrid}>
            <label className="block">
              <span className="label mb-1.5 block">
                {requiredTrades.length > 0
                  ? "Which part of the work"
                  : "Trade (type of work)"}
              </span>
              {requiredTrades.length > 0 ? (
                <>
                  <select
                    className="input"
                    value={row.custom ? OTHER : row.trade}
                    onChange={(e) =>
                      update(
                        i,
                        e.target.value === OTHER
                          ? { custom: true, trade: "" }
                          : { custom: false, trade: e.target.value }
                      )
                    }
                  >
                    <option value="">Choose the trade…</option>
                    {requiredTrades.map((t) => (
                      <option key={t} value={t}>
                        {t}
                        {priced.has(t.trim().toLowerCase()) ? " (already priced)" : ""}
                      </option>
                    ))}
                    <option value={OTHER}>Something else (type it in)</option>
                  </select>
                  {row.custom && (
                    <input
                      className="input mt-2"
                      placeholder="Name the trade"
                      value={row.trade}
                      onChange={(e) => update(i, { trade: e.target.value })}
                    />
                  )}
                </>
              ) : (
                <input
                  className="input"
                  placeholder="e.g. HVAC"
                  value={row.trade}
                  onChange={(e) => update(i, { trade: e.target.value })}
                  list="trades"
                />
              )}
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Subcontractor (optional)</span>
              <select
                className="input"
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
              <span className="label mb-1.5 block">Their quote ($)</span>
              <input
                className="input num"
                type="number"
                inputMode="numeric"
                placeholder="e.g. 42000"
                value={row.quote_amount}
                onChange={(e) => update(i, { quote_amount: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Payment terms</span>
              <input
                className="input"
                placeholder="e.g. Net 30"
                value={row.payment_terms}
                onChange={(e) => update(i, { payment_terms: e.target.value })}
              />
            </label>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Remove quote ${i + 1}`}
                className="mb-0.5 hidden h-9 w-9 items-center justify-center rounded-md border border-border text-slate-500 transition-colors hover:border-risk/60 hover:text-risk lg:inline-flex"
              >
                ✕
              </button>
            )}
          </div>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="mt-2 text-xs text-slate-500 hover:text-risk lg:hidden"
            >
              Remove this quote
            </button>
          )}
        </div>
      ))}

      {error && <p className="text-sm text-risk">{error}</p>}
      {notice && !error && <p className="text-sm text-pursue">{notice}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-ghost"
          onClick={() =>
            setRows((r) => {
              // Offer the next piece of work that still has no price, rather
              // than a blank the operator has to name themselves.
              const taken = new Set(
                r.map((row) => row.trade.trim().toLowerCase()).filter(Boolean)
              );
              const next =
                requiredTrades.find((t) => {
                  const key = t.trim().toLowerCase();
                  return !priced.has(key) && !taken.has(key);
                }) ?? "";
              return [...r, emptyRow(next)];
            })
          }
        >
          + Add another trade
        </button>
        <button className="btn-success" onClick={submit} disabled={loading}>
          {loading ? "Saving..." : "Save quotes & build bid"}
        </button>
      </div>
    </div>
  );
}
