"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ALL_KPI_METRICS, getMetric } from "@/lib/domain/kpi";

/**
 * Add / remove custom KPIs on the Analytics dashboard. Metrics come from a fixed
 * catalog (no free-form queries); the operator picks one, optionally sets a
 * window or minimum score, and names it.
 */
export function KpiManager() {
  const router = useRouter();
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState(ALL_KPI_METRICS[0].id);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("30");
  const [minScore, setMinScore] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const def = getMetric(metric);

  async function save() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const params: Record<string, number> = {};
      if (def?.usesDays) params.days = Number(days);
      if (def?.usesMinScore) params.minScore = Number(minScore);
      const res = await fetch("/api/kpis", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric, label, params }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not add KPI.");
        return;
      }
      setLabel("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("The save was not confirmed. Check your metrics before trying again. Your entries are still here.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        + Add KPI
      </button>
    );
  }

  return (
    <div className="card space-y-3">
      <p className="eyebrow">Add a KPI</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1 block">Metric</span>
          <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {/*
              Every metric the reports compute is pinnable, from the same
              catalog. Two lists would let a pinned "Win rate" and a reported
              one drift, and an operator reading both has no way to tell which
              is right.
            */}
            {ALL_KPI_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {def && <span className="mt-1 block text-xs text-slate-500">{def.help}</span>}
        </label>
        <label className="block">
          <span className="label mb-1 block">Name (optional)</span>
          <input
            className="input"
            placeholder={def?.label ?? "KPI name"}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        {def?.usesDays && (
          <label className="block">
            <span className="label mb-1 block">Window (days, 0 = all time)</span>
            <input
              type="number"
              className="input"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
        )}
        {def?.usesMinScore && (
          <label className="block">
            <span className="label mb-1 block">Minimum score (0-100)</span>
            <input
              type="number"
              className="input"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary text-sm" onClick={save} disabled={saving}>
          {saving ? "Adding…" : "Add KPI"}
        </button>
        <button className="btn-ghost text-sm" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </button>
        {error && <span role="alert" className="text-xs text-risk">{error}</span>}
      </div>
    </div>
  );
}

/** Delete control shown on each custom KPI card. */
export function KpiDeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/kpis/${id}`, { method: "DELETE", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) { setError("The KPI could not be removed. Try again."); return; }
      setAsking(false);
      router.refresh();
    } catch {
      setError("Removal was not confirmed. Check your metrics before trying again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <ConfirmDialog
        open={asking}
        title="Remove this KPI?"
        body={<><p>The metric stops being tracked. The underlying data is untouched.</p>{error && <p role="alert" className="mt-2 text-risk">{error}</p>}</>}
        confirmLabel="Remove it"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setAsking(false)}
      />
      <button
        className="text-xs text-slate-500 hover:text-risk"
        onClick={() => setAsking(true)}
        disabled={busy}
        aria-label="Remove KPI"
      >
        &times;
      </button>
    </>
  );
}
