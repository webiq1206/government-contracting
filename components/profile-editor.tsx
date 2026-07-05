"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyProfileJson } from "@/lib/types";

/** Nested/advanced objects edited as raw JSON in a textarea. */
const ADVANCED_KEYS = [
  "scoring_rubric",
  "hard_exclusions",
  "sub_standards",
  "pricing_rules",
  "decision_thresholds",
  "notes",
] as const;

const ARRAY_FIELDS = [
  "certifications",
  "naics_codes",
  "primary_trades",
  "service_areas",
] as const;

function toCsv(v: unknown): string {
  return Array.isArray(v) ? v.map((x) => String(x)).join(", ") : "";
}
function fromCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function ProfileEditor({ json }: { json: CompanyProfileJson }) {
  const router = useRouter();

  // Top-level identity + pricing fields
  const [legalName, setLegalName] = useState(json.legal_name ?? "");
  const [dba, setDba] = useState(json.dba ?? "");
  const [uei, setUei] = useState(json.uei ?? "");
  const [cage, setCage] = useState(json.cage_code ?? "");
  const [entityState, setEntityState] = useState(json.entity_state ?? "");
  const [smallBusiness, setSmallBusiness] = useState(Boolean(json.small_business));
  const [targetMargin, setTargetMargin] = useState(String(json.target_margin_pct ?? ""));
  const [minMargin, setMinMargin] = useState(String(json.min_margin_pct ?? ""));
  const [maxMarkup, setMaxMarkup] = useState(String(json.max_markup_pct ?? ""));

  // Array fields (comma-joined)
  const [certifications, setCertifications] = useState(toCsv(json.certifications));
  const [naics, setNaics] = useState(toCsv(json.naics_codes));
  const [trades, setTrades] = useState(toCsv(json.primary_trades));
  const [serviceAreas, setServiceAreas] = useState(toCsv(json.service_areas));

  // Advanced nested objects as JSON text
  const advancedInitial: Record<string, unknown> = {};
  for (const k of ADVANCED_KEYS) {
    if (json[k] !== undefined) advancedInitial[k] = json[k];
  }
  const [advancedText, setAdvancedText] = useState(
    JSON.stringify(advancedInitial, null, 2)
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    setError(null);
    setOk(false);

    let advanced: Record<string, unknown>;
    try {
      advanced = JSON.parse(advancedText);
      if (advanced == null || typeof advanced !== "object" || Array.isArray(advanced)) {
        throw new Error("Advanced section must be a JSON object.");
      }
    } catch (e) {
      setError(`Advanced JSON is invalid: ${(e as Error).message}`);
      return;
    }

    const num = (s: string) => {
      const n = Number(s);
      return Number.isNaN(n) ? 0 : n;
    };

    const full: CompanyProfileJson = {
      ...json,
      legal_name: legalName,
      dba: dba || undefined,
      uei: uei || undefined,
      cage_code: cage || undefined,
      entity_state: entityState || undefined,
      small_business: smallBusiness,
      target_margin_pct: num(targetMargin),
      min_margin_pct: num(minMargin),
      max_markup_pct: num(maxMarkup),
      certifications: fromCsv(certifications),
      naics_codes: fromCsv(naics),
      primary_trades: fromCsv(trades),
      service_areas: fromCsv(serviceAreas),
      ...advanced,
    } as CompanyProfileJson;

    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(full),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Save failed");
        return;
      }
      setOk(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Identity */}
      <section className="card space-y-4">
        <h2 className="label">Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Legal name" value={legalName} onChange={setLegalName} />
          <Field label="DBA" value={dba} onChange={setDba} />
          <Field label="UEI" value={uei} onChange={setUei} />
          <Field label="CAGE code" value={cage} onChange={setCage} />
          <Field label="Entity state" value={entityState} onChange={setEntityState} />
          <label className="flex items-center gap-2 pt-6 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={smallBusiness}
              onChange={(e) => setSmallBusiness(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-surface"
            />
            Small business
          </label>
        </div>
      </section>

      {/* Pricing */}
      <section className="card space-y-4">
        <h2 className="label">Pricing</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Target margin %" value={targetMargin} onChange={setTargetMargin} type="number" />
          <Field label="Min margin %" value={minMargin} onChange={setMinMargin} type="number" />
          <Field label="Max markup %" value={maxMarkup} onChange={setMaxMarkup} type="number" />
        </div>
      </section>

      {/* Scope arrays */}
      <section className="card space-y-4">
        <h2 className="label">Scope (comma-separated)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Certifications" value={certifications} onChange={setCertifications} />
          <Field label="NAICS codes" value={naics} onChange={setNaics} />
          <Field label="Primary trades" value={trades} onChange={setTrades} />
          <Field label="Service areas" value={serviceAreas} onChange={setServiceAreas} />
        </div>
      </section>

      {/* Advanced JSON */}
      <section className="card space-y-3">
        <div>
          <h2 className="label">Advanced (raw JSON)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Scoring rubric, hard exclusions, sub standards, pricing rules, decision thresholds, and
            notes. Edit as JSON; it must parse before saving.
          </p>
        </div>
        <textarea
          value={advancedText}
          onChange={(e) => setAdvancedText(e.target.value)}
          spellCheck={false}
          rows={20}
          className="input scroll-thin font-mono text-xs leading-relaxed"
        />
      </section>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save profile"}
        </button>
        {error && <span className="text-sm text-risk">{error}</span>}
        {ok && !error && <span className="text-sm text-pursue">Saved. New version published.</span>}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1"
      />
    </label>
  );
}
