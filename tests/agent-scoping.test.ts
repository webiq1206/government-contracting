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
 * KNOWN_SCANS is the set that existed when this guard was written. It is debt,
 * deliberately recorded rather than silently carried, and the test fails if it
 * GROWS. Shrinking it is the point; anything new has to be justified here.
 */
const TENANT_TABLES = [
  "subcontractors", "opportunities", "contracts", "quotes", "bids", "call_cards",
  "communications", "compliance_items", "content_library", "custom_kpis",
  "documents", "pricing_comps",
];

/**
 * Agents with cross-tenant scans still outstanding, and what each risks.
 *
 *   compliance-monitor  a dedupe lookup can match another org's item, and the
 *                       non-small-business sweep reads every org's contracts
 *   learning-loop       proposes scoring weights from every tenant's outcomes
 *   maintenance         follow-ups, scoring recovery, and expiry sweeps select
 *                       across tenants
 *   sub-finder          can reuse ANOTHER organization's subcontractor on this
 *                       organization's opportunity, which is the worst of them
 */
const KNOWN_SCANS: Record<string, number> = {
  "compliance-monitor.ts": 2,
  "learning-loop.ts": 2,
  "maintenance.ts": 6,
  "sub-finder.ts": 2,
};

function crossTenantScans(src: string): string[] {
  const tbl = TENANT_TABLES.join("|");
  const out: string[] = [];
  for (const lit of src.match(/`[^`]*`/g) ?? []) {
    const flat = lit.replace(/\s+/g, " ");
    if (!new RegExp(`\\b(from|join)\\s+(${tbl})\\b`).test(flat)) continue;
    if (flat.includes("org_id")) continue;
    if (!/^`select/i.test(flat)) continue;
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
