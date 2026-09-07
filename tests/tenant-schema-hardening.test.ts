import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "db/migrations/106_tenant_relationship_guards.sql",
  "utf8"
);
const verifier = readFileSync("scripts/verify-tenant-isolation.ts", "utf8");
const seed = readFileSync("scripts/seed.ts", "utf8");
const createUser = readFileSync("scripts/create-user.ts", "utf8");

const requiredOwners = [
  "company_profile",
  "scoring_weights",
  "opportunities",
  "subcontractors",
  "opportunity_subs",
  "quotes",
  "pricing_comps",
  "bids",
  "contracts",
  "communications",
  "documents",
  "templates",
  "compliance_items",
  "call_cards",
  "content_library",
  "custom_kpis",
  "file_blobs",
  "subcontractor_reply_events",
  "subcontractor_documents",
  "subcontractor_payments",
  "reply_drafts",
  "backlink_competitors",
  "backlink_prospects",
  "backlink_outreach",
  "backlinks",
  "authority_snapshots",
] as const;

describe("database tenant relationship hardening", () => {
  it("gives the opportunity-subcontractor join an explicit tenant owner", () => {
    expect(migration).toMatch(
      /alter table public\.opportunity_subs[\s\S]*add column if not exists org_id uuid references public\.organizations\(id\)/i
    );
    expect(migration).toMatch(
      /os\.opportunity_id = o\.id[\s\S]*os\.subcontractor_id = s\.id[\s\S]*o\.org_id = s\.org_id/i
    );
  });

  it("derives a child owner and rejects every cross-tenant reference", () => {
    expect(migration).toMatch(/create or replace function public\.enforce_tenant_reference/i);
    expect(migration).toMatch(
      /function public\.enforce_tenant_reference\(\)[\s\S]*language plpgsql\s+security definer\s+set search_path = pg_catalog/i
    );
    expect(migration).toMatch(/if new\.org_id is null then\s+new\.org_id := parent_org/i);
    expect(migration).toMatch(/new\.org_id <> parent_org/i);
    expect(migration).toContain("constraint = 'tenant_reference_guard'");
    expect(migration).toMatch(/from pg_catalog\.pg_constraint fk/i);
    expect(migration).toMatch(/before insert or update of org_id, %I/i);
    expect(migration).toMatch(
      /incident_requeues_source_run_fk[\s\S]*foreign key \(source_run_id\) references public\.job_runs\(id\)[\s\S]*not valid/i
    );
    expect(migration).toMatch(
      /incident_requeues_opportunity_fk[\s\S]*foreign key \(opportunity_id\) references public\.opportunities\(id\)[\s\S]*not valid/i
    );
  });

  it("prevents an owned record from being moved between tenants", () => {
    expect(migration).toMatch(/create or replace function public\.prevent_tenant_reassignment/i);
    expect(migration).toMatch(
      /function public\.prevent_tenant_reassignment\(\)[\s\S]*language plpgsql\s+security definer\s+set search_path = pg_catalog/i
    );
    expect(migration).toMatch(/old\.org_id is not null[\s\S]*new\.org_id is distinct from old\.org_id/i);
    expect(migration).toMatch(
      /new\.org_id is null[\s\S]*not exists \(\s*select 1 from public\.organizations where id = old\.org_id/i
    );
    expect(migration).not.toContain("current_setting('brostco.allow_tenant_reassignment'");
    expect(migration).not.toMatch(/fk\.confdeltype = 'n'/i);
    expect(migration).toContain("constraint = 'tenant_ownership_immutable'");
  });

  it("enforces new ownership without scanning or rewriting uncertain legacy rows", () => {
    expect(migration).toMatch(/check \(org_id is not null\) not valid/i);
    expect(migration).not.toMatch(/alter column org_id set not null/i);
    expect(migration).not.toMatch(/force row level security/i);
    expect(migration).not.toMatch(
      /update public\.opportunity_subs[\s\S]*set org_id\s*=\s*'00000000-0000-4000-8000-000000000001'/i
    );
    for (const table of requiredOwners) {
      expect(migration, `${table} must require a tenant owner`).toContain(`'${table}'`);
      expect(verifier, `${table} must be checked before deployment`).toContain(`"${table}"`);
    }
  });

  it("removes global backlink collisions only after tenant replacements exist", () => {
    expect(migration).toMatch(
      /backlink_competitors_org_domain_uniq[\s\S]*\(org_id, domain\)/i
    );
    expect(migration).toMatch(
      /backlink_prospects_org_domain_type_uniq[\s\S]*\(org_id, domain, opportunity_type\)/i
    );
    expect(migration).toMatch(
      /backlinks_org_source_target_uniq[\s\S]*\(org_id, source_url, target_url\)/i
    );
    expect(migration).toMatch(/having count\(\*\) > 1/i);

    const replacement = migration.indexOf("backlink_competitors_org_domain_uniq");
    const removal = migration.indexOf("drop constraint if exists backlink_competitors_domain_key");
    expect(replacement).toBeGreaterThan(-1);
    expect(removal).toBeGreaterThan(replacement);
  });

  it("keeps trigger administration out of browser-facing RPC roles", () => {
    for (const fn of [
      "enforce_tenant_reference",
      "prevent_tenant_reassignment",
      "install_tenant_reference_guards",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn}() from public`);
      expect(migration).toContain(`public.${fn}() from anon`);
      expect(migration).toContain(`public.${fn}() from authenticated`);
    }
  });

  it("keeps fresh-install profile and scoring seeds tenant-owned", () => {
    expect(seed).toMatch(/insert into company_profile\s+\(org_id,/i);
    expect(seed).toMatch(/insert into scoring_weights\s+\(org_id,/i);
    expect(seed.match(/LEGACY_ORG_ID/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("creates the seeded operator and its tenant membership atomically", () => {
    expect(seed).toMatch(/transaction\(async \(client\)/);
    expect(seed).toMatch(
      /insert into organization_members \(org_id, user_id, role\)[\s\S]*LEGACY_ORG_ID/i
    );
  });

  it("creates CLI users inside a verified organization transaction", () => {
    expect(createUser).toContain("orgIdArg?.trim() || LEGACY_ORG_ID");
    expect(createUser).toMatch(/transaction\(async \(client\)/);
    expect(createUser).toMatch(/select id, name from organizations where id = \$1/);
    expect(createUser).toMatch(
      /insert into organization_members \(org_id, user_id, role\)[\s\S]*on conflict \(org_id, user_id\) do update/i
    );
    expect(createUser).toContain("organization role:");
  });
});

describe("tenant isolation deployment gate", () => {
  it("fails closed on a runtime role that owns tables or bypasses RLS", () => {
    expect(verifier).toContain("r.rolbypassrls as bypasses_rls");
    expect(verifier).toContain("c.relowner = r.oid");
    expect(verifier).toContain("elevated.rolsuper or elevated.rolbypassrls");
    expect(verifier).toContain("pg_catalog.pg_has_role");
    expect(verifier).toMatch(/Runtime role .* can bypass row-level security/);
  });

  it("checks RLS, untrusted grants, null owners, guards, and live relationship data", () => {
    expect(verifier).toContain("not c.relrowsecurity");
    expect(verifier).toContain("pg_catalog.aclexplode");
    expect(verifier).toContain("where org_id is null");
    expect(verifier).toContain("p.proname = 'enforce_tenant_reference'");
    expect(verifier).toContain("p.proname = 'prevent_tenant_reassignment'");
    expect(verifier).toContain("t.tgenabled in ('O','A')");
    expect(verifier).toContain("org_column.attnum = any(t.tgattr::smallint[])");
    expect(verifier).toContain("and p.prosecdef");
    expect(verifier).toContain("'search_path=pg_catalog'");
    expect(verifier).toMatch(
      /parent\.id is null[\s\S]*child\.org_id is null[\s\S]*parent\.org_id is null[\s\S]*child\.org_id <> parent\.org_id/
    );
    expect(verifier).toContain("VALIDATE CONSTRAINT");
  });

  it("is read-only and exits nonzero on any failed gate", () => {
    expect(verifier).not.toMatch(
      /`\s*(insert|update|delete|alter|create|drop|truncate)\b/i
    );
    expect(verifier).toContain("process.exitCode = 1");
  });
});
