"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TokenMultiSelect, type TokenOption } from "@/components/token-multi-select";
import { NAICS_CODES } from "@/lib/naics";
import { US_SERVICE_AREAS, FEDERAL_CERTIFICATIONS } from "@/lib/us-states";
import type {
  CompanyProfileJson,
  HardExclusion,
  SubStandards,
  PricingRules,
  DecisionThresholds,
} from "@/lib/types";

// Option lists for the scope multi-selects, built once at module load.
const NAICS_OPTIONS: TokenOption[] = NAICS_CODES.map((n) => ({
  value: n.code,
  label: `${n.code} · ${n.title}`,
}));
const SERVICE_AREA_OPTIONS: TokenOption[] = US_SERVICE_AREAS.map((s) => ({ value: s, label: s }));
const CERT_OPTIONS: TokenOption[] = FEDERAL_CERTIFICATIONS.map((c) => ({ value: c, label: c }));

/**
 * Plain-English company profile editor. Everything an operator needs to change
 * is a labeled field, never raw JSON. The deep, technical config (scoring rubric
 * weights, alert-day schedules, inflation series) is preserved untouched on save
 * and tuned automatically in the background, so it never appears here.
 */

const ARRAY_HELP: Record<string, string> = {
  certifications: "Your small-business certifications, e.g. SDVOSB, HUBZone, 8(a).",
  naics_codes: "The federal industry codes you bid under. One project's code decides if it fits you.",
  primary_trades: "The kinds of work you broker, e.g. HVAC, electrical, roofing.",
  service_areas: "States or regions you work in, e.g. ID, OR, WA.",
};

function toCsv(v: unknown): string {
  return Array.isArray(v) ? v.map((x) => String(x)).join(", ") : "";
}
function fromCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function fromCsvNum(s: string): number[] {
  return s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n));
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "rule";
}

export function ProfileEditor({ json }: { json: CompanyProfileJson }) {
  const router = useRouter();

  const std: Partial<SubStandards> = json.sub_standards ?? {};
  const pr: Partial<PricingRules> = json.pricing_rules ?? {};
  const dt: Partial<DecisionThresholds> = json.decision_thresholds ?? {};

  // Identity + contact
  const [legalName, setLegalName] = useState(json.legal_name ?? "");
  const [dba, setDba] = useState(json.dba ?? "");
  const [uei, setUei] = useState(json.uei ?? "");
  const [cage, setCage] = useState(json.cage_code ?? "");
  const [entityState, setEntityState] = useState(json.entity_state ?? "");
  const [structure, setStructure] = useState(json.business_structure ?? "");
  const [smallBusiness, setSmallBusiness] = useState(Boolean(json.small_business));
  const [phone, setPhone] = useState(json.phone ?? "");
  const [email, setEmail] = useState(json.email ?? "");
  const [outreachEmail, setOutreachEmail] = useState(json.outreach_email ?? "");
  const [address, setAddress] = useState(json.physical_address ?? "");
  const [ownerName, setOwnerName] = useState(json.owner_name ?? "");
  const [outreachDisplayName, setOutreachDisplayName] = useState(
    json.outreach_display_name ?? (json.owner_name ?? "").trim().split(/\s+/)[0] ?? ""
  );
  const [ownerTitle, setOwnerTitle] = useState(json.owner_title ?? "");

  // Pricing
  const [targetMargin, setTargetMargin] = useState(String(json.target_margin_pct ?? ""));
  const [minMargin, setMinMargin] = useState(String(json.min_margin_pct ?? ""));
  const [maxMarkup, setMaxMarkup] = useState(String(json.max_markup_pct ?? ""));
  const [markupDefault, setMarkupDefault] = useState(String(pr.markup_default_pct ?? ""));
  const [tolerance, setTolerance] = useState(String(pr.out_of_range_tolerance_pct ?? ""));
  const [marginScenarios, setMarginScenarios] = useState(toCsv(pr.margin_scenarios));

  // Scope arrays
  const [certifications, setCertifications] = useState(toCsv(json.certifications));
  const [naics, setNaics] = useState(toCsv(json.naics_codes));
  const [trades, setTrades] = useState(toCsv(json.primary_trades));
  const [serviceAreas, setServiceAreas] = useState(toCsv(json.service_areas));

  // Subcontractor standards
  const [requireLicense, setRequireLicense] = useState(std.require_active_license ?? true);
  const [requireNotExcluded, setRequireNotExcluded] = useState(
    std.require_not_sam_excluded ?? true
  );
  const [minRating, setMinRating] = useState(std.min_google_rating != null ? String(std.min_google_rating) : "");
  const [minReviews, setMinReviews] = useState(std.min_reviews != null ? String(std.min_reviews) : "");
  const [perTrade, setPerTrade] = useState(String(std.candidates_per_trade ?? ""));
  const [verifyTop, setVerifyTop] = useState(String(std.verify_top_n ?? ""));

  // Decision limits (the automation-band thresholds live in the card above this)
  const [valueMin, setValueMin] = useState(dt.value_min != null ? String(dt.value_min) : "");
  const [valueMax, setValueMax] = useState(dt.value_max != null ? String(dt.value_max) : "");
  const [unrestrictedMin, setUnrestrictedMin] = useState(
    dt.unrestricted_min_value != null ? String(dt.unrestricted_min_value) : ""
  );
  const [minSubs, setMinSubs] = useState(String(dt.min_subs_per_trade ?? ""));
  const [leadHours, setLeadHours] = useState(String(dt.submit_lead_hours ?? ""));

  // Things we never bid on
  const [exclusions, setExclusions] = useState<HardExclusion[]>(
    json.hard_exclusions?.length
      ? json.hard_exclusions
      : []
  );

  const [notes, setNotes] = useState(json.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // Any edit marks the form dirty (via onChangeCapture on the root, plus the
  // click-driven rule add/remove below); the sticky bar says so, and leaving
  // the page with unsaved edits asks first.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function updateExclusion(i: number, patch: Partial<HardExclusion>) {
    setDirty(true);
    setExclusions((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setError(null);
    setOk(false);

    const num = (s: string) => {
      const n = Number(s);
      return Number.isNaN(n) ? 0 : n;
    };
    const numOpt = (s: string): number | undefined => {
      if (s.trim() === "") return undefined;
      const n = Number(s);
      return Number.isNaN(n) ? undefined : n;
    };

    const subStandards: SubStandards = {
      ...(json.sub_standards ?? ({} as SubStandards)),
      require_active_license: requireLicense,
      require_not_sam_excluded: requireNotExcluded,
      min_google_rating: numOpt(minRating),
      min_reviews: numOpt(minReviews),
      candidates_per_trade: num(perTrade),
      verify_top_n: num(verifyTop),
    };

    const pricingRules: PricingRules = {
      ...(json.pricing_rules ?? ({} as PricingRules)),
      markup_default_pct: num(markupDefault),
      out_of_range_tolerance_pct: num(tolerance),
      margin_scenarios: fromCsvNum(marginScenarios),
    };

    const decisionThresholds: DecisionThresholds = {
      ...(json.decision_thresholds ?? ({} as DecisionThresholds)),
      value_min: numOpt(valueMin),
      value_max: numOpt(valueMax),
      unrestricted_min_value: numOpt(unrestrictedMin),
      min_subs_per_trade: num(minSubs),
      submit_lead_hours: num(leadHours),
    };

    const hardExclusions: HardExclusion[] = exclusions
      .filter((r) => r.label.trim() !== "" || r.rule.trim() !== "")
      .map((r) => ({
        key: r.key?.trim() || slug(r.label),
        label: r.label.trim(),
        rule: r.rule.trim(),
      }));

    const full: CompanyProfileJson = {
      ...json,
      legal_name: legalName,
      dba: dba || undefined,
      uei: uei || undefined,
      cage_code: cage || undefined,
      entity_state: entityState || undefined,
      business_structure: structure || undefined,
      small_business: smallBusiness,
      phone: phone || undefined,
      email: email || undefined,
      outreach_email: outreachEmail || undefined,
      physical_address: address || undefined,
      owner_name: ownerName || undefined,
      outreach_display_name:
        outreachDisplayName.trim() ||
        (ownerName || "").trim().split(/\s+/)[0] ||
        undefined,
      owner_title: ownerTitle || undefined,
      target_margin_pct: num(targetMargin),
      min_margin_pct: num(minMargin),
      max_markup_pct: num(maxMarkup),
      certifications: fromCsv(certifications),
      naics_codes: fromCsv(naics),
      primary_trades: fromCsv(trades),
      service_areas: fromCsv(serviceAreas),
      sub_standards: subStandards,
      pricing_rules: pricingRules,
      decision_thresholds: decisionThresholds,
      hard_exclusions: hardExclusions,
      notes: notes || undefined,
    };

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
      setDirty(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5" onChangeCapture={() => setDirty(true)}>
      {/* Identity */}
      <Section title="Company identity" hint="The legal details that go on every bid.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Legal name" value={legalName} onChange={setLegalName} />
          <Field label="Doing-business-as (DBA)" value={dba} onChange={setDba} />
          <Field
            label="UEI"
            value={uei}
            onChange={setUei}
            hint="Unique Entity ID: your company's official ID in SAM.gov. It goes on every federal bid and form."
          />
          <Field
            label="CAGE code"
            value={cage}
            onChange={setCage}
            hint="Commercial and Government Entity code: a five-character ID used on DoD and many federal forms alongside your UEI."
          />
          <Field label="Home state" value={entityState} onChange={setEntityState} placeholder="ID" />
          <Field label="Business structure" value={structure} onChange={setStructure} placeholder="LLC" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={smallBusiness}
            onChange={(e) => setSmallBusiness(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          We qualify as a small business
        </label>
      </Section>

      {/* Contact */}
      <Section title="Contact" hint="Where the government and your subs reach you.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Owner name" value={ownerName} onChange={setOwnerName} />
          <Field
            label="Outreach display name"
            value={outreachDisplayName}
            onChange={setOutreachDisplayName}
            placeholder="First name only"
            hint="Shown to subcontractors in emails (first name only; never a last name)."
          />
          <Field label="Owner title" value={ownerTitle} onChange={setOwnerTitle} placeholder="Owner" />
          <Field label="Phone" value={phone} onChange={setPhone} type="tel" placeholder="(208) 555-0100" />
          <Field label="Email" value={email} onChange={setEmail} type="email" />
          <Field
            label="Outreach email"
            value={outreachEmail}
            onChange={setOutreachEmail}
            type="email"
            hint="All subcontractor emails are sent from this address."
          />
          <Field label="Physical address" value={address} onChange={setAddress} />
        </div>
      </Section>

      {/* Scope */}
      <Section title="What you bid on" hint="Search and pick, or type your own and press Enter.">
        <div className="grid gap-4 sm:grid-cols-2">
          <PickerField label="Certifications" hint={ARRAY_HELP.certifications}>
            <TokenMultiSelect
              value={certifications}
              onChange={setCertifications}
              options={CERT_OPTIONS}
              allowCustom
              placeholder="Search certifications, or type your own…"
            />
          </PickerField>
          <PickerField label="Industry codes (NAICS)" hint={ARRAY_HELP.naics_codes}>
            <TokenMultiSelect
              value={naics}
              onChange={setNaics}
              options={NAICS_OPTIONS}
              allowCustom
              placeholder="Search by code or keyword, e.g. janitorial…"
            />
          </PickerField>
          <Field label="Primary trades" value={trades} onChange={setTrades} hint={ARRAY_HELP.primary_trades} />
          <PickerField label="Service areas" hint={ARRAY_HELP.service_areas}>
            <TokenMultiSelect
              value={serviceAreas}
              onChange={setServiceAreas}
              options={SERVICE_AREA_OPTIONS}
              allowCustom
              placeholder="Search states, or type a region…"
            />
          </PickerField>
        </div>
      </Section>

      {/* Pricing */}
      <Section title="Pricing" hint="How the Bid Builder prices your bids.">
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2.5 text-xs leading-relaxed text-slate-600">
          <p className="font-medium text-slate-700">Margin vs. markup, the quick version</p>
          <p className="mt-1">
            <span className="font-medium text-slate-700">Margin</span> is your profit as a
            share of the final bid.{" "}
            <span className="font-medium text-slate-700">Markup</span> is what you add on
            top of your costs to reach it.
          </p>
          <p className="mt-1">
            Example: on $10,000 of costs, a 30% markup makes your bid $13,000, which is a
            23% margin ($3,000 &divide; $13,000). You set the{" "}
            <span className="font-medium text-slate-700">target margin</span>; markup is
            just the lever that gets there.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Target margin %"
            value={targetMargin}
            onChange={setTargetMargin}
            type="number"
            hint="The profit you aim to make on a job. The Bid Builder prices every bid to hit this automatically."
          />
          <Field
            label="Minimum margin %"
            value={minMargin}
            onChange={setMinMargin}
            type="number"
            hint="The floor. A bid that would earn less than this fails its quality check and stops for your review instead of going out thin."
          />
          <Field
            label="Max markup %"
            value={maxMarkup}
            onChange={setMaxMarkup}
            type="number"
            hint="Safety ceiling: costs are never marked up beyond this, even to reach the target, so a bid can't be priced out of the market chasing margin."
          />
          <Field
            label="Default markup %"
            value={markupDefault}
            onChange={setMarkupDefault}
            type="number"
            hint="The starting markup on subcontractor quotes when there is no pricing history to compare against."
          />
          <Field
            label="Flag a quote if it is this % off comps"
            value={tolerance}
            onChange={setTolerance}
            type="number"
            hint="Any sub quote this far from comparable government awards is marked ⚠ in the quote list and on the bid's quality checklist, so one bad number can't sink the bid unnoticed."
          />
          <Field
            label="Margin scenarios to model %"
            value={marginScenarios}
            onChange={setMarginScenarios}
            hint="Extra what-if margins shown in the bid brief (price and profit at each), for comparing before you sign off. Comma-separated, e.g. 25, 35, 50."
          />
        </div>
      </Section>

      {/* Subcontractor standards */}
      <Section title="Subcontractor standards" hint="The bar a sub must clear before the system uses them.">
        <div className="space-y-2">
          <CheckRow checked={requireLicense} onChange={setRequireLicense} label="Only use licensed subcontractors" />
          <CheckRow checked={requireNotExcluded} onChange={setRequireNotExcluded} label="Skip debarred (government-excluded) companies" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Min Google rating"
            value={minRating}
            onChange={setMinRating}
            type="number"
            placeholder="4.0"
            hint="Out of 5. Candidates below this never make the list. Blank = no minimum."
          />
          <Field
            label="Min number of reviews"
            value={minReviews}
            onChange={setMinReviews}
            type="number"
            placeholder="10"
            hint="A high rating from 2 reviews is weak evidence. This many reviews are required before the rating counts."
          />
          <Field
            label="Subs to find per trade"
            value={perTrade}
            onChange={setPerTrade}
            type="number"
            placeholder="12"
            hint="How wide the automatic search casts for each trade. More = better coverage, but more outreach volume per job."
          />
          <Field
            label="Subs to verify closely"
            value={verifyTop}
            onChange={setVerifyTop}
            type="number"
            placeholder="5"
            hint="Only the top-ranked candidates get the full check (license, verified email, exclusion list) before any email goes out."
          />
        </div>
      </Section>

      {/* Decision limits */}
      <Section
        title="Which jobs to chase"
        hint="Size and timing limits. The pursue / review score bands are set in the card above."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Smallest contract ($)"
            value={valueMin}
            onChange={setValueMin}
            type="number"
            placeholder="50000"
            hint="Anything smaller is passed automatically, too small to cover the overhead of bidding."
          />
          <Field
            label="Largest before manual review ($)"
            value={valueMax}
            onChange={setValueMax}
            type="number"
            placeholder="350000"
            hint="Bigger jobs still enter the pipeline, but always stop for your explicit approval instead of auto-pursuing."
          />
          <Field
            label="Smallest unrestricted contract ($)"
            value={unrestrictedMin}
            onChange={setUnrestrictedMin}
            type="number"
            placeholder="150000"
            hint="Open competition below this is passed, since too many bidders turn up to win often enough to be worth pricing. Set-aside work is judged on the smallest-contract figure instead, whatever its size."
          />
          <Field
            label="Min subs per trade to bid"
            value={minSubs}
            onChange={setMinSubs}
            type="number"
            placeholder="2"
            hint="Below this many verified subs for any required trade, the bid pauses and asks you rather than pricing from a single quote."
          />
          <Field
            label="Submit this many hours early"
            value={leadHours}
            onChange={setLeadHours}
            type="number"
            placeholder="2"
            hint="Submission is blocked closer to the deadline than this, your buffer for portal outages and last-minute fixes. You can override with an explicit confirmation."
          />
        </div>
      </Section>

      {/* Hard exclusions */}
      <Section
        title="Things you never bid on"
        hint="Deal-breakers, written in plain English. The scoring system reads each rule and checks every incoming notice against it; a match means the opportunity is passed automatically, with the rule it hit recorded on the record so you can always see why. Keep each rule specific: name the exact condition that makes a job a no-go."
      >
        <div className="space-y-3">
          {exclusions.length === 0 && (
            <p className="text-sm text-slate-500">None yet. Add one below if there is work you always avoid.</p>
          )}
          {exclusions.map((row, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-[1fr_1.6fr_auto] sm:items-end">
              <label className="block">
                <span className="label mb-1 block">Name</span>
                <input
                  className="input"
                  placeholder="e.g. Hazmat work"
                  value={row.label}
                  onChange={(e) => updateExclusion(i, { label: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="label mb-1 block">Rule (plain English)</span>
                <input
                  className="input"
                  placeholder="Skip anything mentioning hazardous material removal"
                  value={row.rule}
                  onChange={(e) => updateExclusion(i, { rule: e.target.value })}
                />
              </label>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => { setDirty(true); setExclusions((r) => r.filter((_, idx) => idx !== i)); }}
                className="mb-0.5 hidden h-9 w-9 items-center justify-center rounded-md border border-border text-slate-500 transition-colors hover:border-risk/60 hover:text-risk sm:inline-flex"
              >
                ✕
              </button>
              <button
                type="button"
                onClick={() => { setDirty(true); setExclusions((r) => r.filter((_, idx) => idx !== i)); }}
                className="text-left text-xs text-slate-500 hover:text-risk sm:hidden"
              >
                Remove this rule
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => { setDirty(true); setExclusions((r) => [...r, { key: "", label: "", rule: "" }]); }}
          >
            + Add a rule
          </button>
        </div>
      </Section>

      {/* Notes */}
      <Section
        title="Notes"
        hint="Standing instructions in your own words. This text rides along on every AI decision (scoring, analysis, outreach, bids), so anything written here is honored across the whole platform. Good for policies that don't fit a field above."
      >
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="input"
          placeholder="e.g. We prefer projects within 100 miles of Boise."
        />
      </Section>

      <p className="px-1 text-xs text-slate-500">
        Scoring weights and technical schedules are tuned automatically in the
        background, so they are not shown here. Nothing you leave untouched is lost.
      </p>

      <div
        className={`sticky bottom-16 z-10 flex flex-wrap items-center gap-3 border-t py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:bottom-0 ${
          dirty ? "border-review/50 bg-review/5" : "border-border bg-background/95"
        }`}
      >
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save profile"}
        </button>
        {dirty && !saving && !error && (
          <span className="text-sm font-medium text-review">
            Unsaved changes, they apply to scoring only after you save.
          </span>
        )}
        {error && <span className="text-sm text-risk">{error}</span>}
        {ok && !error && !dirty && (
          <span className="text-sm text-pursue">Saved. New version published.</span>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** Wraps a non-input control (e.g. the multi-select) with the same label + hint. */
function PickerField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      {label}
    </label>
  );
}
