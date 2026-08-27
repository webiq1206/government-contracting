/**
 * What changed between two profile versions, in the words of what it affects.
 *
 * The profile is versioned already, and nothing ever showed the versions. So
 * "who widened the service area in March and why did the feed change" had
 * nowhere to be answered from, on a record that scoring, eligibility and every
 * generated document read as the source of truth.
 *
 * A diff of raw JSON keys would answer it badly. `min_margin_pct: 8 → 12` is
 * the fact; "the floor every bid is priced against went from 8% to 12%" is the
 * change. Pure.
 */

import type { CompanyProfileJson } from "../types";

export interface ProfileChange {
  field: string;
  /** What changed, in a sentence somebody can act on. */
  summary: string;
  /** True when this one alters what gets found, scored, or priced. */
  material: boolean;
}

/** Fields worth reporting, and what each one governs. */
const WATCHED: {
  key: keyof CompanyProfileJson;
  label: string;
  /** Changing this alters the pipeline rather than the letterhead. */
  material: boolean;
}[] = [
  { key: "legal_name", label: "the legal name on every bid", material: false },
  { key: "uei", label: "the UEI", material: false },
  { key: "cage_code", label: "the CAGE code", material: false },
  { key: "outreach_email", label: "the address subcontractor email is sent from", material: true },
  { key: "small_business", label: "small business status", material: true },
  { key: "certifications", label: "the certifications set-aside matching reads", material: true },
  { key: "naics_codes", label: "the codes the opportunity feed filters on", material: true },
  { key: "psc_codes", label: "the PSC codes", material: true },
  { key: "excluded_naics", label: "the codes deliberately kept out", material: true },
  { key: "primary_trades", label: "the trades subcontractor sourcing searches for", material: true },
  { key: "service_areas", label: "where work is considered local", material: true },
  { key: "target_margin_pct", label: "the margin every bid aims at", material: true },
  { key: "min_margin_pct", label: "the floor every bid is priced against", material: true },
  { key: "max_markup_pct", label: "the markup cap", material: true },
  { key: "bonding_capacity", label: "the bonding capacity eligibility checks against", material: true },
  { key: "hard_exclusions", label: "the work that is refused outright", material: true },
  { key: "notes", label: "the standing instructions every agent reads", material: true },
  { key: "legal_guardrails", label: "the guardrails on generated documents", material: true },
];

function show(v: unknown): string {
  if (v == null || v === "") return "nothing";
  if (Array.isArray(v)) {
    if (v.length === 0) return "nothing";
    const items = v.map((x) =>
      x && typeof x === "object" && "label" in (x as Record<string, unknown>)
        ? String((x as Record<string, unknown>).label)
        : String(x)
    );
    // Long lists are summarized rather than printed: a history entry naming
    // forty NAICS codes is one nobody reads.
    return items.length > 4
      ? `${items.slice(0, 4).join(", ")} and ${items.length - 4} more`
      : items.join(", ");
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

/**
 * Compares values by shape rather than by reference.
 *
 * Arrays compare unordered: a profile re-saved with its NAICS codes in a
 * different order has not changed, and reporting it as one fills the history
 * with edits nobody made, which is how a history stops being read.
 */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const key = (x: unknown) =>
      x && typeof x === "object" ? JSON.stringify(x) : String(x);
    const as = a.map(key).sort();
    const bs = b.map(key).sort();
    return as.every((v, i) => v === bs[i]);
  }
  if (a == null && b == null) return true;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return a === b;
}

export function diffProfiles(
  before: CompanyProfileJson | null | undefined,
  after: CompanyProfileJson | null | undefined
): ProfileChange[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const out: ProfileChange[] = [];
  for (const w of WATCHED) {
    const from = a[w.key as string];
    const to = b[w.key as string];
    if (same(from, to)) continue;
    out.push({
      field: String(w.key),
      summary: `${w.label}: ${show(from)} → ${show(to)}`,
      material: w.material,
    });
  }
  // Material changes first: they are why somebody opened the history.
  return out.sort((x, y) => Number(y.material) - Number(x.material));
}

/** A one-line description of a version, for the list. */
export function describeVersion(changes: ProfileChange[]): string {
  if (changes.length === 0) return "Saved with no change to any tracked field.";
  const material = changes.filter((c) => c.material).length;
  if (material === 0) {
    return `${changes.length} detail${changes.length === 1 ? "" : "s"} updated.`;
  }
  // "1 change that affect" is what the obvious wording produces; the verb has
  // to agree with the count as well as the noun.
  return material === 1
    ? "1 change that affects what gets found, scored or priced."
    : `${material} changes that affect what gets found, scored or priced.`;
}
