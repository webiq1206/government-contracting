/**
 * Account deletion must actually delete everything, including the file BYTES.
 *
 * purgeOrganization clears every org_id-bearing table, but file_blobs stores
 * the actual document contents (W-9s, insurance certs, bids) and its org_id
 * was never populated on upload, so a purge deleted zero bytes and a closed
 * account's documents survived. This drives the real purge against a real
 * database with a seeded blob and asserts nothing is left behind.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("account deletion (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let accounts: typeof import("../lib/admin/accounts");
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;
  let storage: typeof import("../lib/integrations/storage").storage;

  const org = { id: "" };

  async function counts() {
    const opp = await queryOne<{ n: number }>(`select count(*)::int as n from opportunities where org_id=$1`, [org.id]);
    const sub = await queryOne<{ n: number }>(`select count(*)::int as n from subcontractors where org_id=$1`, [org.id]);
    const doc = await queryOne<{ n: number }>(`select count(*)::int as n from documents where org_id=$1`, [org.id]);
    const blobOrg = await queryOne<{ n: number }>(`select count(*)::int as n from file_blobs where org_id=$1`, [org.id]);
    return { opp: opp?.n ?? 0, sub: sub?.n ?? 0, doc: doc?.n ?? 0, blobOrg: blobOrg?.n ?? 0 };
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    accounts = await import("../lib/admin/accounts");
    ({ runWithOrg } = await import("../lib/tenant-context"));
    ({ storage } = await import("../lib/integrations/storage"));

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`del-${randomUUID()}`]
    );
    org.id = o!.id;
    // Owner user (NOT a platform admin, so it isn't treated as our own account).
    const u = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role) values ($1,'x','Owner','member') returning id`,
      [`owner-${randomUUID().slice(0,8)}@example.invalid`]
    );
    await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [org.id, u!.id]);

    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status) values ($1,'test','Doomed job','outreach','open') returning id`,
      [org.id]
    );
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state) values ($1,'Doomed Sub',$2,'CA') returning id`,
      [org.id, ["electrical"]]
    );
    // A stored document + its bytes, uploaded inside the org context so the
    // blob is stamped with org_id (the fix).
    const key = `opportunities/${op!.id}/secret.pdf`;
    await runWithOrg(org.id, () => storage.upload(key, Buffer.from("SECRET BYTES"), "application/pdf"));
    await query(
      `insert into documents (org_id, opportunity_id, kind, name, storage_path, storage_backend, mime)
       values ($1,$2,'solicitation','secret.pdf',$3,'db','application/pdf')`,
      [org.id, op!.id, key]
    );
    // clean up the possible local-file copy is unnecessary; db backend used here.
  });

  afterAll(async () => {
    // Best-effort: if a test failed before purge, clean up.
    if (org.id) {
      await query(`delete from file_blobs where org_id=$1`, [org.id]).catch(() => {});
      await accounts.purgeOrganization?.(org.id).catch?.(() => {});
    }
  });

  it("seeds real rows and a real blob stamped with the org", async () => {
    const c = await counts();
    expect(c.opp).toBe(1);
    expect(c.sub).toBe(1);
    expect(c.doc).toBe(1);
    expect(c.blobOrg).toBe(1); // the fix: the blob carries org_id
  });

  it("purge removes every row AND the file bytes, leaving nothing", async () => {
    await accounts.purgeOrganization(org.id);
    const c = await counts();
    expect(c).toEqual({ opp: 0, sub: 0, doc: 0, blobOrg: 0 });
    // The organization row itself is gone.
    const orgRow = await queryOne<{ id: string }>(`select id from organizations where id=$1`, [org.id]);
    expect(orgRow).toBeNull();
    org.id = ""; // stop afterAll from re-purging
  });

  it("deleteAccount refuses without the exact name typed back", async () => {
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`del2-${randomUUID()}`]
    );
    const u = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role) values ($1,'x','O','member') returning id`,
      [`o2-${randomUUID().slice(0,8)}@example.invalid`]
    );
    await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [o!.id, u!.id]);
    const res = await accounts.deleteAccount({ orgId: o!.id, confirmName: "wrong name", adminEmail: "admin@x" });
    expect(res.ok).toBe(false);
    // Still there.
    expect((await queryOne<{ id: string }>(`select id from organizations where id=$1`, [o!.id]))?.id).toBe(o!.id);
    await accounts.purgeOrganization(o!.id);
    await query(`delete from users where id=$1`, [u!.id]).catch(() => {});
  });
});
