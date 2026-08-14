import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Background agents must not read across organizations.
 *
 * The data layer has its own guard, but the analytics engine showed that one
 * is not enough: it lived in an agent, computed every tenant's bids and
 * contracts into a single snapshot, and listed other customers' subcontractors
 * by name. Nothing caught it because nothing looked at agents.
 *
 * Most agent SQL is safe without an org filter, and the distinction is worth
 * stating: an agent handed one opportunity id from a queue payload is already
 * scoped by whoever enqueued it. The dangerous shape is a SCAN, a select with
 * no single-record predicate, which reads whatever exists in the table and
 * therefore reads every tenant's rows.
 *
 * KNOWN_SCANS recorded the twelve that existed when this guard was written,
 * as debt rather than something silently carried. All twelve are now scoped
 * and the map is empty, so the rule is simply that agents do not scan. A new
 * entry here is a deliberate decision to ship an unscoped read, and needs the
 * risk written down beside it.
 */
const TENANT_TABLES = [
  "subcontractors", "opportunities", "contracts", "quotes", "bids", "call_cards",
  "communications", "compliance_items", "content_library", "custom_kpis",
  "documents", "pricing_comps",
];

/** Agents with cross-tenant scans still outstanding. There are none. */
const KNOWN_SCANS: Record<string, number> = {};

/**
 * Reads that are global on purpose, and have to stay that way.
 *
 * This is not the same list as KNOWN_SCANS: that one is debt to be paid off,
 * this one is a set of reads where adding an org filter would be the bug. Each
 * is matched on a fragment unique to it so an unrelated unscoped read cannot
 * inherit the exemption, and each says why below.
 */
const DELIBERATELY_GLOBAL = [
  // maintenance: before deleting a file blob, check whether ANY document still
  // references that path. Blob paths are content-addressed and shared between
  // organizations, so scoping this to one org would delete bytes another
  // customer's document still points at.
  "from file_blobs where path = any($1)",
];

function crossTenantScans(src: string): string[] {
  const tbl = TENANT_TABLES.join("|");
  const out: string[] = [];
  for (const lit of src.match(/`[^`]*`/g) ?? []) {
    const flat = lit.replace(/\s+/g, " ");
    if (!new RegExp(`\\b(from|join)\\s+(${tbl})\\b`).test(flat)) continue;
    if (flat.includes("org_id")) continue;
    if (!/^`select/i.test(flat)) continue;
    if (DELIBERATELY_GLOBAL.some((frag) => flat.includes(frag))) continue;
    // A predicate naming one record means the caller already scoped it.
    if (/\b\w*id\s*=\s*\$\d/.test(flat)) continue;
    if (/\bid\s*=\s*any\(/.test(flat)) continue;
    out.push(flat.slice(0, 100));
  }
  return out;
}

describe("agents do not read across organizations", () => {
  const files = readdirSync("lib/agents").filter((f) => f.endsWith(".ts"));

  it("finds the agents it is meant to be checking", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("has no cross-tenant scan outside the recorded set", () => {
    const unexpected: string[] = [];
    for (const f of files) {
      const scans = crossTenantScans(readFileSync(join("lib/agents", f), "utf8"));
      const allowed = KNOWN_SCANS[f] ?? 0;
      if (scans.length > allowed) {
        unexpected.push(
          `${f}: ${scans.length} scans, ${allowed} recorded\n    ${scans.slice(allowed).join("\n    ")}`
        );
      }
    }
    expect(
      unexpected,
      `New cross-tenant scans. Scope them by organization, or record them in ` +
        `KNOWN_SCANS with the risk stated:\n\n${unexpected.join("\n\n")}`
    ).toEqual([]);
  });

  it("keeps sub finder scoped, since it writes what it reads", () => {
    // The dedupe lookups key off google_place_id and company_name, which the
    // scan check treats as single-record predicates and therefore skips. They
    // are not: the same firm sits on several customers' rosters, so an
    // unscoped match returns another org's row and then updates it.
    const src = readFileSync("lib/agents/sub-finder.ts", "utf8");
    expect(crossTenantScans(src)).toEqual([]);
    for (const lit of src.match(/`[^`]*`/g) ?? []) {
      const flat = lit.replace(/\s+/g, " ");
      if (!/^`select .* from subcontractors\b/i.test(flat)) continue;
      expect(flat, "every subcontractor read must name its org").toContain("org_id");
    }
    expect(src, "a sub with no org is invisible to the roster that created it").toMatch(
      /insert into subcontractors\s*\(\s*org_id,/
    );
  });

  it("keeps the analytics engine scoped, since its snapshot is customer-facing", () => {
    // It mixed every tenant's numbers into one snapshot and named other
    // customers' subcontractors in the rankings.
    const src = readFileSync("lib/agents/analytics-engine.ts", "utf8");
    expect(crossTenantScans(src)).toEqual([]);
    expect(src, "snapshot must carry the org it describes").toMatch(
      /insert into agent_logs \(org_id,/
    );
    expect(src, "must compute per organization").toMatch(/runWithOrg\(org\.id/);
  });
});
