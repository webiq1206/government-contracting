/**
 * Real PostgreSQL RLS and connection-reuse checks.
 *
 * Role creation is intentionally limited to the built-in isolated development
 * database and an explicit opt-in. The normal suite has no authority to alter
 * roles. Run after migrations with:
 *
 *   USE_REPLIT_DEV_DB=true RUN_RLS_INTEGRATION=1 npm test -- tenant-rls-context.integration
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const isolated = ["1", "true", "yes", "on"].includes(
  (process.env.USE_REPLIT_DEV_DB ?? "").toLowerCase()
);
const optedIn = process.env.RUN_RLS_INTEGRATION === "1";
const deployment = Boolean(process.env.REPLIT_DEPLOYMENT || process.env.REPLIT_DEPLOYMENT_ID);
const d = isolated && optedIn && !deployment && Boolean(process.env.DATABASE_URL)
  ? describe
  : describe.skip;

d("transaction-local PostgreSQL tenant RLS (integration)", () => {
  let db: typeof import("../lib/db");
  const orgA = randomUUID();
  const orgB = randomUUID();
  const oppA = randomUUID();
  const oppB = randomUUID();
  const roleName = `brostco_rls_probe_${randomUUID().replaceAll("-", "")}`;
  const roleIdent = `"${roleName}"`;
  let roleCreated = false;

  beforeAll(async () => {
    db = await import("../lib/db");
    await db.query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,$2,'active',true), ($3,$4,'active',true)`,
      [orgA, `rls-a-${orgA}`, orgB, `rls-b-${orgB}`]
    );
    await db.query(
      `insert into opportunities (id, org_id, source, title, stage, status)
       values ($1,$2,'test','RLS A','monitoring','open'),
              ($3,$4,'test','RLS B','monitoring','open')`,
      [oppA, orgA, oppB, orgB]
    );

    await db.query(
      `create role ${roleIdent} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`
    );
    roleCreated = true;
    await db.query(`grant ${roleIdent} to current_user`);
    await db.query(`grant usage on schema public to ${roleIdent}`);
    await db.query(
      `grant select, insert, update, delete on public.organizations, public.opportunities to ${roleIdent}`
    );
  });

  afterAll(async () => {
    if (!db) return;
    if (roleCreated) {
      await db.query(`revoke ${roleIdent} from current_user`).catch(() => {});
      await db.query(`revoke all on public.organizations, public.opportunities from ${roleIdent}`).catch(
        () => {}
      );
      await db.query(`revoke usage on schema public from ${roleIdent}`).catch(() => {});
      await db.query(`drop role if exists ${roleIdent}`).catch(() => {});
    }
    await db.query(`delete from opportunities where id = any($1::uuid[])`, [[oppA, oppB]]).catch(
      () => {}
    );
    await db.query(`delete from organizations where id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await db.closePool().catch(() => {});
  });

  it("shows only the active organization's rows to a non-owner role", async () => {
    const rows = await db.tenantTransaction(orgA, async (client) => {
      await client.query(`set local role ${roleIdent}`);
      return client.query<{ id: string }>(
        `select id from opportunities where id = any($1::uuid[]) order by id`,
        [[oppA, oppB]]
      );
    });

    expect(rows.rows.map((row) => row.id)).toEqual([oppA]);
  });

  it("rejects a cross-tenant insert even when the SQL names the other owner", async () => {
    await expect(
      db.tenantTransaction(orgA, async (client) => {
        await client.query(`set local role ${roleIdent}`);
        await client.query(
          `insert into opportunities (org_id, source, title, stage, status)
           values ($1,'test','Cross-tenant RLS probe','monitoring','open')`,
          [orgB]
        );
      })
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot update or delete a row hidden behind another tenant boundary", async () => {
    const result = await db.tenantTransaction(orgA, async (client) => {
      await client.query(`set local role ${roleIdent}`);
      const updated = await client.query(
        `update opportunities set title = 'RLS tamper probe' where id = $1 returning id`,
        [oppB]
      );
      const deleted = await client.query(
        `delete from opportunities where id = $1 returning id`,
        [oppB]
      );
      return { updated: updated.rowCount, deleted: deleted.rowCount };
    });

    expect(result).toEqual({ updated: 0, deleted: 0 });
  });

  it("clears local tenant context before the same connection is reused", async () => {
    const client = await db.pool().connect();
    try {
      await client.query("begin");
      await db.setLocalTenantContext(client, orgA);
      await client.query(`set local role ${roleIdent}`);
      const inside = await client.query<{ org_id: string | null }>(
        `select nullif(pg_catalog.current_setting('brostco.org_id', true), '') as org_id`
      );
      expect(inside.rows[0]?.org_id).toBe(orgA);
      await client.query("commit");

      await client.query("begin");
      await client.query(`set local role ${roleIdent}`);
      const after = await client.query<{ org_id: string | null }>(
        `select nullif(pg_catalog.current_setting('brostco.org_id', true), '') as org_id`
      );
      expect(after.rows[0]?.org_id).toBeNull();
      const hidden = await client.query<{ count: number }>(
        `select count(*)::int as count from opportunities where id = any($1::uuid[])`,
        [[oppA, oppB]]
      );
      expect(hidden.rows[0]?.count).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("also clears local tenant context after rollback on the same connection", async () => {
    const client = await db.pool().connect();
    try {
      await client.query("begin");
      await db.setLocalTenantContext(client, orgB);
      await client.query("rollback");

      await client.query("begin");
      await client.query(`set local role ${roleIdent}`);
      const after = await client.query<{ org_id: string | null }>(
        `select nullif(pg_catalog.current_setting('brostco.org_id', true), '') as org_id`
      );
      expect(after.rows[0]?.org_id).toBeNull();
      const hidden = await client.query<{ count: number }>(
        `select count(*)::int as count from opportunities where id = any($1::uuid[])`,
        [[oppA, oppB]]
      );
      expect(hidden.rows[0]?.count).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
