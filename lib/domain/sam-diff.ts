/**
 * What a SAM.gov import would change, field by field, before it changes it.
 *
 * The import card showed what SAM holds. It never showed what that would
 * replace. So an operator who had corrected a legal name, or spent an
 * afternoon curating fourteen NAICS codes down from a registration listing
 * forty, pressed "Import these details" and lost that work with no warning
 * and no undo. The registration is not authoritative about how this company
 * wants to bid; it is authoritative about how it registered, and those are
 * different things.
 *
 * The audit asks for a field-by-field comparison before changes are applied.
 * This produces one, and it is deliberately per-field selectable: the common
 * case is wanting the UEI and the address from SAM while keeping the NAICS
 * list you built, and an all-or-nothing import cannot express that.
 */

/** What applying this field would do to what is already on file. */
export type FieldVerdict =
  | "same" // identical; applying it is a no-op
  | "fill" // nothing on file; applying it adds information
  | "replace" // something different on file; applying it overwrites
  | "absent"; // SAM has nothing; there is nothing to apply

export interface FieldDiff {
  key: string;
  label: string;
  /** What is on the profile now, in display form. */
  current: string | null;
  /** What SAM returned, in display form. */
  incoming: string | null;
  verdict: FieldVerdict;
  /** For list fields: what would be added and lost, so the cost is visible. */
  added?: string[];
  removed?: string[];
  kept?: string[];
}

const FIELDS: { key: string; label: string; list?: boolean }[] = [
  { key: "legal_name", label: "Legal name" },
  { key: "dba", label: "Doing business as" },
  { key: "uei", label: "UEI" },
  { key: "cage_code", label: "CAGE code" },
  { key: "physical_address", label: "Physical address" },
  { key: "entity_state", label: "Home state" },
  { key: "business_structure", label: "Business structure" },
  { key: "naics_codes", label: "NAICS codes", list: true },
  { key: "certifications", label: "Certifications", list: true },
];

function asList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => String(x).trim()).filter((x) => x.length > 0);
  return out;
}

function asText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

export function diffProfile(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>
): FieldDiff[] {
  return FIELDS.map(({ key, label, list }) => {
    if (list) {
      const inc = asList(incoming[key]);
      const cur = asList(current[key]) ?? [];
      if (!inc || inc.length === 0) {
        return {
          key,
          label,
          current: cur.length ? cur.join(", ") : null,
          incoming: null,
          verdict: "absent" as FieldVerdict,
        };
      }
      const added = inc.filter((x) => !cur.includes(x));
      const removed = cur.filter((x) => !inc.includes(x));
      const kept = cur.filter((x) => inc.includes(x));
      const verdict: FieldVerdict =
        cur.length === 0 ? "fill" : sameList(cur, inc) ? "same" : "replace";
      return {
        key,
        label,
        current: cur.length ? cur.join(", ") : null,
        incoming: inc.join(", "),
        verdict,
        added,
        removed,
        kept,
      };
    }
    const inc = asText(incoming[key]);
    const cur = asText(current[key]);
    const verdict: FieldVerdict =
      inc == null ? "absent" : cur == null ? "fill" : cur === inc ? "same" : "replace";
    return { key, label, current: cur, incoming: inc, verdict };
  });
}

/** The fields worth showing a checkbox for: the ones that would actually do something. */
export function applicable(diffs: FieldDiff[]): FieldDiff[] {
  return diffs.filter((d) => d.verdict === "fill" || d.verdict === "replace");
}

/**
 * Which fields to tick by default.
 *
 * Filling an empty field is safe and is what somebody importing wants.
 * Overwriting something they typed is not, so a replacement starts unticked
 * and has to be chosen. This is the whole point of the comparison: the
 * destructive half of an import should require a decision, not a reflex.
 */
export function defaultSelection(diffs: FieldDiff[]): string[] {
  return diffs.filter((d) => d.verdict === "fill").map((d) => d.key);
}

export interface ImportSummary {
  fills: number;
  replaces: number;
  /** Individual list entries that would be dropped across every selected list field. */
  losing: number;
  /** True when nothing is selected, so the button has nothing to do. */
  empty: boolean;
}

export function summarize(diffs: FieldDiff[], selected: string[]): ImportSummary {
  const picked = diffs.filter((d) => selected.includes(d.key));
  return {
    fills: picked.filter((d) => d.verdict === "fill").length,
    replaces: picked.filter((d) => d.verdict === "replace").length,
    losing: picked.reduce((n, d) => n + (d.removed?.length ?? 0), 0),
    empty: picked.length === 0,
  };
}

/** Builds the patch to send, from the fields actually chosen. */
export function patchFor(
  diffs: FieldDiff[],
  selected: string[],
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of diffs) {
    if (!selected.includes(d.key)) continue;
    if (d.verdict !== "fill" && d.verdict !== "replace") continue;
    const v = incoming[d.key];
    if (v == null) continue;
    out[d.key] = v;
  }
  return out;
}

const VERDICT_LABEL: Record<FieldVerdict, string> = {
  same: "Already matches",
  fill: "Would fill in",
  replace: "Would replace",
  absent: "Not on the registration",
};

export function verdictLabel(v: FieldVerdict): string {
  return VERDICT_LABEL[v];
}
