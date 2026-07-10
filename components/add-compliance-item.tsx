"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Preset categories. Values match the Compliance Monitor's category keys where
 *  they overlap, so a manual item folds into the same group as tracked ones. */
const CATEGORIES: { value: string; label: string }[] = [
  { value: "insurance", label: "Insurance" },
  { value: "certification", label: "Certification" },
  { value: "state_llc", label: "State / LLC Registration" },
  { value: "bond", label: "Bond" },
  { value: "license", label: "License" },
  { value: "contract_deadline", label: "Contract Deadline" },
  { value: "other", label: "Other" },
];

/**
 * Add your own compliance item to track. Creates a source='operator' item that
 * the Compliance Monitor never overwrites. A due date is optional but turns on
 * the countdown and alerts.
 */
export function AddComplianceItem() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0].value);
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!label.trim()) {
      setError("Give it a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, category, due_at: dueAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not add.");
        return;
      }
      setLabel("");
      setDueAt("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        + Add your own item
      </button>
    );
  }

  return (
    <div className="card space-y-3">
      <p className="eyebrow">Track your own item</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-1">
          <span className="label mb-1 block">Name</span>
          <input
            className="input"
            placeholder="e.g. General liability policy"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label mb-1 block">Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label mb-1 block">Renewal / due date (optional)</span>
          <input
            type="date"
            className="input"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary text-sm" onClick={save} disabled={saving}>
          {saving ? "Adding…" : "Add item"}
        </button>
        <button
          className="btn-ghost text-sm"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
        {error && <span className="text-xs text-risk">{error}</span>}
      </div>
    </div>
  );
}
