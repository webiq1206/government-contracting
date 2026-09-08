import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Nothing on the server may read across organizations.
 *
 * This guard began by checking lib/agents, because the analytics engine had
 * mixed every tenant's numbers into one snapshot and nothing looked at agents.
 * That boundary turned out to be the wrong one twice over. Reply capture
 * matched one customer's inbound email against another customer's outreach,
 * and the Action Center listed other customers' quote amounts and compliance
 * items on the dashboard. Neither is in lib/agents. Agents call into lib, and
 * lib was never checked, so it now reads all of it.
 *
 * Most SQL here is safe without an org filter, and the distinction is worth
 * stating: a query handed one record id is already scoped by whoever supplied
 * it. The dangerous shape is a SCAN, a select with no single-record predicate,
 * which reads whatever exists in the table and therefore reads every tenant's
 * rows.
 *
 * KNOWN_SCANS recorded the twelve that existed when this guard was written, as
 * debt rather than something silently carried. All are now scoped and the map
 * is empty, so the rule is simply that server code does not scan. A new entry
 * is a deliberate decision to ship an unscoped read, and needs the risk
 * written down beside it.
 */
const TENANT_TABLES = [
  "company_profile", "subcontractors", "opportunities", "contracts", "quotes", "bids",
  "call_cards", "communications", "compliance_items", "content_library", "custom_kpis",
  "documents", "pricing_comps", "scoring_weights", "templates", "agent_logs",
  "integration_tokens", "integration_settings", "app_settings", "file_blobs", "job_runs",
  "backlink_competitors", "backlink_prospects", "backlink_outreach",
  "backlinks", "authority_snapshots", "opportunity_subs", "subcontractor_reply_events",
  "subcontractor_documents", "subcontractor_payments", "reply_drafts", "sam_daily_calls",
  "email_suppressions", "conversation_flags", "automation_incidents", "incident_events",
  "incident_requeues", "unmatched_inbound", "bid_submission_events", "bid_overrides",
  "trade_pricing_rows", "bid_calculation_snapshots", "outreach_suppressions",
  "solicitation_verifications", "saved_views", "requirement_states",
  "requirement_state_events", "subcontractor_performance_events", "subcontractor_merges",
  "subcontractor_contacts", "subcontractor_licenses", "subcontractor_tags",
  "subcontractor_bulk_actions", "compliance_item_events", "compliance_item_documents",
  "contract_milestones", "contract_modifications", "contract_invoices", "contract_issues",
  "contract_coordination", "billing_invoices", "feedback_reports", "recap_deliveries",
  "recap_urgent_items", "account_invitations", "platform_key_grants", "platform_key_usage",
  "commission_events", "influencer_payouts", "referral_attributions", "organization_members",
  "analytics_events",
];

/** Files with cross-tenant scans still outstanding. There are none. */
const KNOWN_SCANS: Record<string, number> = {};

/**
 * Directories that are generated or vendored, so a finding there is not
 * something anyone edits.
 */
const SKIP_DIRS = new Set(["node_modules", "dist", "api-zod", "api-client-react"]);

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) serverFiles(path, out);
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

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
  "select candidate.path from unnest($1::text[]) as candidate(path)",
  "from file_blobs where path = any($1)",
  // app_settings.key is the primary key. Tenant settings encode the org in
  // that key; the two platform settings deliberately use an unprefixed key.
  "from app_settings where key = $1",
  // file_blobs.path is a unique, tenant-namespaced ownership key. The storage
  // layer refuses a cross-tenant collision before any read can occur.
  "select bytes from file_blobs where path = $1",
  "select mime from file_blobs where path = $1",
  // These log queries construct a mandatory `org_id = $1` clause before the
  // SQL template is interpolated. The literal cannot show the contents of the
  // variable to this source scanner.
  "from agent_logs ${where}",
  "from agent_logs ${whereSql}",
  // Worker heartbeat is platform process health, not customer data. A global
  // last-run timestamp answers whether the shared worker is alive.
  "select (select max(started_at) from job_runs) as worker_last",
  // Recap bounces arrive in one platform inbox. Matching therefore has to
  // search delivery records across organizations, but recentDeliveryTo now
  // refuses an address-only match when more than one tenant/scope is present.
  "from recap_deliveries where lower(recipient_email) = lower($1)",
  // Invitations exist before a recipient belongs to an organization. These
  // platform-admin and concession sweeps must find unaccepted rows globally;
  // accepted_org_id is nullable until acceptance and the routes are guarded
  // separately by platform-admin or invitation-token credentials.
  "from account_invitations where concession_code = $1",
  "from account_invitations where lower(email) = $1",
  "from account_invitations where accepted_at is null",
  "from account_invitations where accepted_at is not null",
  // storage.getMime: the stored MIME type for a path the caller already holds.
  // Same shared-path reason, and the answer is "this is a PDF", which carries
  // nothing of the document itself.
  "select mime from documents where storage_path = $1",
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

describe("server code does not read across organizations", () => {
  const files = serverFiles("lib");

  it("finds the agents it is meant to be checking", () => {
    expect(readdirSync("lib/agents").filter((f) => f.endsWith(".ts")).length).toBeGreaterThan(10);
  });

  it("reads the whole server tree, not just the agents", () => {
    // The two worst leaks found in this audit were outside lib/agents.
    expect(files).toContain(join("lib", "reply-capture.ts"));
    expect(files).toContain(join("lib", "data.ts"));
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no cross-tenant scan outside the recorded set", () => {
    const unexpected: string[] = [];
    for (const path of files) {
      const scans = crossTenantScans(readFileSync(path, "utf8"));
      const allowed = KNOWN_SCANS[path] ?? 0;
      if (scans.length > allowed) {
        unexpected.push(
          `${path}: ${scans.length} scans, ${allowed} recorded\n    ${scans.slice(allowed).join("\n    ")}`
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

  it("keeps the platform authority scout inside the founding organization", () => {
    const src = readFileSync("lib/agents/backlink-scout.ts", "utf8");
    expect(crossTenantScans(src)).toEqual([]);
    expect(src).toContain("const orgId = LEGACY_ORG_ID");
    expect(src).toContain("runWithOrg(orgId");
    expect(src).toMatch(/insert into authority_snapshots\s+\(org_id,/);
    expect(src).toMatch(/insert into backlinks\s+\(org_id,/);
    expect(src).toMatch(/insert into backlink_competitors\s+\(org_id,/);
    expect(src).toMatch(/insert into backlink_prospects\s+\(org_id,/);
  });
});
