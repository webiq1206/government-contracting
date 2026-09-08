import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

const migration = readFileSync(
  "db/migrations/107_tenant_rls_policies_staged.sql",
  "utf8"
);
const dbSource = readFileSync("lib/db.ts", "utf8");
const verifier = readFileSync("scripts/verify-tenant-isolation.ts", "utf8");

describe("staged tenant RLS policy", () => {
  it("installs a restrictive organization boundary as well as tenant access", () => {
    expect(migration).toMatch(/create policy brostco_tenant_access/i);
    expect(migration).toMatch(
      /create policy brostco_tenant_boundary[\s\S]*as restrictive for all/i
    );
    expect(migration).toContain("current_setting('brostco.org_id', true)");
    expect(migration).toMatch(/alter table public\.%I enable row level security/i);
    expect(migration).toMatch(/alter table public\.organizations enable row level security/i);
  });

  it("does not let a feature policy widen the tenant boundary", () => {
    expect(migration).toMatch(
      /as permissive for all using \(org_id = %s\) with check \(org_id = %s\)/i
    );
    expect(migration).toMatch(
      /as restrictive for all using \(org_id = %s\) with check \(org_id = %s\)/i
    );
    expect(verifier).toContain("!policy.permissive");
    expect(verifier).toContain("brostco_tenant_boundary");
  });

  it("stages known context-free paths as fail-closed blockers", () => {
    for (const table of [
      "account_invitations",
      "analytics_events",
      "app_settings",
      "password_reset_tokens",
      "sessions",
      "stripe_events",
      "templates",
      "user_email_aliases",
      "users",
      "worker_heartbeat",
    ]) {
      expect(migration).toContain(`'${table}'`);
      expect(verifier).toContain(`"${table}"`);
    }
    expect(migration).toMatch(
      /create policy brostco_staged_deny[\s\S]*as restrictive for all using \(false\) with check \(false\)/i
    );
    expect(verifier).toContain("intentionally denied to a non-owner runtime");
  });

  it("makes the migration ledger read-only to a separately granted runtime role", () => {
    expect(migration).toMatch(/alter table public\._migrations enable row level security/i);
    expect(migration).toMatch(
      /brostco_schema_read_access[\s\S]*permissive for select using \(true\)/i
    );
    expect(migration).toMatch(
      /brostco_schema_insert_deny[\s\S]*restrictive for insert with check \(false\)/i
    );
    expect(migration).toMatch(
      /brostco_schema_update_deny[\s\S]*restrictive for update using \(false\) with check \(false\)/i
    );
    expect(migration).toMatch(
      /brostco_schema_delete_deny[\s\S]*restrictive for delete using \(false\)/i
    );
  });

  it("does not force RLS while the application runtime is still the table owner", () => {
    expect(migration).not.toMatch(/alter table[^;]*force row level security/i);
    expect(migration).toContain("Intentionally no FORCE ROW LEVEL SECURITY");
  });

  it("uses only transaction-local context in the database helper", () => {
    expect(dbSource).toContain("setLocalTenantContext");
    expect(dbSource).toContain("pg_catalog.set_config('brostco.org_id', $1, true)");
    expect(dbSource).not.toMatch(/set_config\('brostco\.org_id',\s*\$1,\s*false\)/i);
    expect(dbSource).toMatch(
      /await client\.query\("BEGIN"\);[\s\S]*currentOrgId\(\)[\s\S]*setLocalTenantContext\(client, orgId\)[\s\S]*await fn\(client\)[\s\S]*await client\.query\("COMMIT"\)/
    );
  });

  it("uses the owner credential for exhaustive data checks", () => {
    expect(verifier).toContain("MIGRATION_DATABASE_URL");
    expect(verifier).toContain('integrityClient.query("set row_security = off")');
    expect(verifier).toMatch(
      /verifyRequiredOwners[\s\S]*integrityQuery<OwnerConstraintRow>/
    );
    expect(verifier).toMatch(
      /verifyReferences[\s\S]*integrityQueryOne<\{ count: number \}>/
    );
  });
});

describe("tenant database context helper", () => {
  it("sets the organization with a parameter and local lifetime", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { setLocalTenantContext } = await import("../lib/db");
    const orgId = randomUUID();

    await setLocalTenantContext({ query } as unknown as PoolClient, orgId);

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      `select pg_catalog.set_config('brostco.org_id', $1, true)`,
      [orgId]
    );
  });

  it("rejects a malformed owner before sending SQL", async () => {
    const query = vi.fn();
    const { setLocalTenantContext } = await import("../lib/db");

    await expect(
      setLocalTenantContext({ query } as unknown as PoolClient, "not-an-org")
    ).rejects.toThrow(/valid organization id/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("cannot replace an active job tenant with a different organization", async () => {
    const { tenantTransaction } = await import("../lib/db");
    const { runWithOrg } = await import("../lib/tenant-context");
    const orgA = randomUUID();
    const orgB = randomUUID();

    await expect(
      runWithOrg(orgA, () =>
        tenantTransaction(orgB, async () => {
          throw new Error("The callback must not run.");
        })
      )
    ).rejects.toThrow(/does not match the active organization/i);
  });
});
