"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AutomationRules } from "@/lib/domain/intake";

interface Preview {
  past_due_open: number;
  below_lead_time: number;
  past_retention: number;
}

/**
 * Settings → Automation rules. Every control explains what it does, when it
 * applies, and what happens if it's set wrong; the live preview shows how many
 * records the current values would touch BEFORE anything is saved.
 */
export function AutomationRulesForm({ initial }: { initial: AutomationRules }) {
  const router = useRouter();
  const [form, setForm] = useState<AutomationRules>(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live preview: refetch whenever the values settle for a moment.
  useEffect(() => {
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch("/api/automation/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, preview_only: true }),
        });
        if (res.ok) setPreview((await res.json()).preview);
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/automation/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setForm(data.rules);
      setPreview(data.preview);
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const num =
    (key: keyof AutomationRules) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: Number(e.target.value) }));

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ deadline colors */}
      <section className="card">
        <h2 className="text-base font-semibold text-slate-900">Deadline warning colors</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Every opportunity shows a deadline badge on the Today page, the Pipeline board, and its
          own record. These two numbers decide when that badge changes color. The badge always
          spells out the status and days remaining in words, so nothing depends on color alone.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Turn amber this many days before the deadline"
            hint='The "approaching" warning. Amber means: still on track, but this needs attention soon.'
          >
            <input
              type="number"
              min={1}
              className="input"
              value={form.approaching_days}
              onChange={num("approaching_days")}
            />
          </Field>
          <Field
            label="Turn red this many days before the deadline"
            hint='The "urgent" warning. Red means: drop other work, this bid is at risk of missing its deadline. Must be inside the amber window.'
          >
            <input
              type="number"
              min={1}
              className="input"
              value={form.urgent_days}
              onChange={num("urgent_days")}
            />
          </Field>
        </div>
        {/* Written legend so the meaning of every state is explicit. */}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="badge bg-pursue/10 text-pursue">
            Normal · more than {form.approaching_days} days left
          </span>
          <span className="badge bg-review/15 text-review">
            Approaching · under {form.approaching_days} days
          </span>
          <span className="badge bg-risk/15 text-risk">
            Urgent · under {Math.min(form.urgent_days, form.approaching_days)} days
          </span>
          <span className="badge bg-risk text-white">Past due · deadline passed</span>
          <span className="badge bg-slate-200 text-slate-600">Expired · archived automatically</span>
        </div>
      </section>

      {/* ------------------------------------------------ lead time */}
      <section className="card">
        <h2 className="text-base font-semibold text-slate-900">Minimum lead time</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          A bid needs time: reading the solicitation, finding and verifying subcontractors,
          collecting quotes by phone, building the package, and submitting early. This rule
          catches new solicitations that are due too soon to do all of that properly,{" "}
          <span className="font-medium text-slate-800">before</span> they enter the pipeline and
          waste outreach on a bid you can&rsquo;t finish. It never touches opportunities already
          in progress.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Minimum days between arrival and the deadline"
            hint="Set 0 to turn this rule off. 7–14 days is typical: under a week rarely leaves time for sub quotes."
          >
            <input
              type="number"
              min={0}
              className="input"
              value={form.min_lead_days}
              onChange={num("min_lead_days")}
            />
          </Field>
          <Field
            label="What to do with a too-short opportunity"
            hint='"Send to my review queue" lets you rescue one worth a rush. "Pass automatically" archives it with the reason recorded. Either way the record shows exactly why: the deadline, days remaining, and your minimum.'
          >
            <select
              className="select"
              value={form.lead_action}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  lead_action: e.target.value === "dismiss" ? "dismiss" : "review",
                }))
              }
            >
              <option value="review">Send to my review queue</option>
              <option value="dismiss">Pass automatically</option>
            </select>
          </Field>
        </div>
      </section>

      {/* ------------------------------------------------ retention */}
      <section className="card">
        <h2 className="text-base font-semibold text-slate-900">Archive &amp; cleanup</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Expired and dismissed opportunities are <span className="font-medium text-slate-800">archived, never deleted</span>:
          they leave the active pipeline but keep every document, email, and log entry. This
          setting controls if and when archived records are eventually purged. Records with a
          bid or a contract are <span className="font-medium text-slate-800">always kept</span>, regardless of this
          setting, they are part of your business history.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Days to keep archived records"
            hint="0 = keep everything forever (recommended until storage becomes a concern). If set, a nightly job permanently deletes archived records older than this, only when they have no bid and no contract."
          >
            <input
              type="number"
              min={0}
              className="input"
              value={form.retention_days}
              onChange={num("retention_days")}
            />
          </Field>
        </div>
      </section>

      {/* ------------------------------------------------ preview + save */}
      <section className="card border-accent/40 bg-accent-soft/40">
        <h2 className="text-base font-semibold text-slate-900">
          What these values would do right now
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Checked live against your current data{previewing ? ", updating…" : ""}. Nothing
          happens until you press Save.
        </p>
        {preview && (
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
            <li>
              <span className="num font-semibold">{preview.past_due_open}</span> open{" "}
              opportunit{preview.past_due_open === 1 ? "y has" : "ies have"} already passed their
              deadline, the hourly sweep will archive {preview.past_due_open === 1 ? "it" : "them"}{" "}
              (with history preserved).
            </li>
            <li>
              <span className="num font-semibold">{preview.below_lead_time}</span> not-yet-scored{" "}
              opportunit{preview.below_lead_time === 1 ? "y" : "ies"} would fail the minimum
              lead-time rule{form.min_lead_days === 0 ? " (rule is off)" : ""}.
            </li>
            <li>
              <span className="num font-semibold">{preview.past_retention}</span> archived{" "}
              record{preview.past_retention === 1 ? "" : "s"} would be permanently deleted by the
              retention rule
              {form.retention_days === 0 ? " (retention is set to keep forever)" : ""}.
            </li>
          </ul>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save rules"}
          </button>
          {savedAt && !saving && (
            <span className="text-xs text-pursue">Saved at {savedAt}. Applied everywhere immediately.</span>
          )}
          {error && <span className="text-xs text-risk">{error}</span>}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>
    </label>
  );
}
