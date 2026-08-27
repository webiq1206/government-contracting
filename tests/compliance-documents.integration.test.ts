/**
 * The company's own certificates, stored rather than linked.
 *
 * A compliance item used to offer one text box for "a link to your document",
 * which is a pointer to a file somewhere else: it breaks when somebody leaves,
 * a folder moves, or a share setting tightens, and it cannot be produced when
 * a contracting officer asks. These tests drive the real store against a real
 * database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("compliance documents (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let mod: typeof import("../lib/compliance-documents");
  let ownership: typeof import("../lib/domain/file-ownership");

  const tag = randomUUID();
  let orgId = "";
  let otherOrgId = "";
  let itemId = "";
  let otherItemId = "";
  let userId = "";

  function pdf(name: string, bytes = 1024): File {
    return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    mod = await import("../lib/compliance-documents");
    ownership = await import("../lib/domain/file-ownership");

    const mkOrg = async (suffix: string) =>
      (await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`compdocs-${suffix}-${tag}`]
      ))!.id;
    orgId = await mkOrg("a");
    otherOrgId = await mkOrg("b");

    userId = (await queryOne<{ id: string }>(
      `insert into users (email, name, password_hash) values ($1,'Doc Tester','x') returning id`,
      [`compdocs-${tag}@example.test`]
    ))!.id;

    const mkItem = async (org: string, label: string) =>
      (await queryOne<{ id: string }>(
        `insert into compliance_items (org_id, category, label, source)
         values ($1,'insurance',$2,'operator') returning id`,
        [org, label]
      ))!.id;
    itemId = await mkItem(orgId, `General liability ${tag}`);
    otherItemId = await mkItem(otherOrgId, `Someone else's policy ${tag}`);
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      await query(`delete from compliance_item_documents where org_id = $1`, [org]).catch(() => {});
      await query(`delete from compliance_item_events where org_id = $1`, [org]).catch(() => {});
      await query(`delete from compliance_items where org_id = $1`, [org]).catch(() => {});
      await query(`delete from agent_logs where org_id = $1`, [org]).catch(() => {});
      await query(`delete from file_blobs where org_id = $1`, [org]).catch(() => {});
      await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    }
    if (userId) await query(`delete from users where id = $1`, [userId]).catch(() => {});
  });

  it("stores a file against the item and files an event about it", async () => {
    const out = await mod.attachDocument({
      orgId,
      itemId,
      file: pdf("gl-policy.pdf"),
      kind: "policy",
      actorId: userId,
    });
    expect(out.ok).toBe(true);

    const docs = await mod.documentsFor(orgId, [itemId]);
    expect(docs.get(itemId)?.length).toBe(1);
    expect(docs.get(itemId)?.[0].original_filename).toBe("gl-policy.pdf");

    const events = await query<{ kind: string; summary: string }>(
      `select kind, summary from compliance_item_events where item_id = $1 and kind = 'document'`,
      [itemId]
    );
    expect(events.length).toBe(1);
    expect(events[0].summary).toContain("gl-policy.pdf");
  });

  it("marks the obligation satisfied but not verified", async () => {
    /*
     * The distinction the subcontractor side already draws. Storing a scan is
     * evidence somebody sent a file; it is not evidence anybody read it, and
     * conflating them is how a certificate naming the wrong insured sits on a
     * record looking checked.
     */
    const row = await queryOne<{ satisfied_at: Date | null; verified_at: Date | null }>(
      `select satisfied_at, verified_at from compliance_items where id = $1`,
      [itemId]
    );
    expect(row?.satisfied_at).not.toBeNull();
    expect(row?.verified_at).toBeNull();
  });

  it("refuses a file that is too large, by name", async () => {
    const big = new File([new Uint8Array(13 * 1024 * 1024)], "huge-scan.pdf", {
      type: "application/pdf",
    });
    const out = await mod.attachDocument({ orgId, itemId, file: big, actorId: userId });
    expect(out.ok).toBe(false);
    // Named, because a batch upload's failure list is useless without it.
    if (!out.ok) {
      expect(out.error).toContain("huge-scan.pdf");
      expect(out.error).toContain("12 MB");
    }
  });

  it("refuses a file type nobody can open as a certificate", async () => {
    const exe = new File([new Uint8Array(16)], "installer.exe", {
      type: "application/octet-stream",
    });
    const out = await mod.attachDocument({ orgId, itemId, file: exe, actorId: userId });
    expect(out.ok).toBe(false);
  });

  it("stores nothing against another organization's item", async () => {
    const out = await mod.attachDocument({
      orgId,
      itemId: otherItemId,
      file: pdf("not-mine.pdf"),
      actorId: userId,
    });
    expect(out.ok).toBe(false);

    // And nothing landed on the other tenant's record either.
    const theirs = await mod.documentsFor(otherOrgId, [otherItemId]);
    expect(theirs.get(otherItemId) ?? []).toEqual([]);
  });

  it("never lists another organization's documents", async () => {
    const docs = await mod.documentsFor(otherOrgId, [itemId]);
    expect(docs.get(itemId) ?? []).toEqual([]);
  });

  it("resolves the stored key back to the owning organization", async () => {
    /*
     * The check /api/files makes on every request. A key this resolver does
     * not recognize is refused to everybody, so a compliance document that
     * uploads fine and then 404s on open is exactly what a missing entry
     * here looks like.
     */
    const doc = await queryOne<{ storage_path: string }>(
      `select storage_path from compliance_item_documents where item_id = $1 limit 1`,
      [itemId]
    );
    expect(doc).not.toBeNull();
    expect(await ownership.orgOwnsStorageKey(doc!.storage_path, orgId)).toBe(true);
    expect(await ownership.orgOwnsStorageKey(doc!.storage_path, otherOrgId)).toBe(false);
  });

  it("keeps a replaced certificate instead of overwriting it", async () => {
    const first = await mod.attachDocument({
      orgId, itemId, file: pdf("2025-cert.pdf"), kind: "certificate", actorId: userId,
    });
    expect(first.ok).toBe(true);
    const second = await mod.attachDocument({
      orgId, itemId, file: pdf("2026-cert.pdf"), kind: "certificate", actorId: userId,
      replaces: first.ok ? first.id : null,
    });
    expect(second.ok).toBe(true);

    const rows = await query<{ id: string; superseded_by: string | null }>(
      `select id::text as id, superseded_by::text as superseded_by
         from compliance_item_documents where item_id = $1`,
      [itemId]
    );
    const old = rows.find((r) => first.ok && r.id === first.id);
    // Still there. "What was on file at the time" is the question an audit
    // asks, and a record holding only the current certificate cannot answer.
    expect(old).toBeDefined();
    expect(second.ok && old?.superseded_by).toBe(second.ok ? second.id : null);
  });

  it("will not let another tenant's document be marked superseded", async () => {
    const mine = await mod.attachDocument({
      orgId: otherOrgId, itemId: otherItemId, file: pdf("theirs.pdf"), actorId: null,
    });
    expect(mine.ok).toBe(true);

    await mod.attachDocument({
      orgId, itemId, file: pdf("mine.pdf"), actorId: userId,
      replaces: mine.ok ? mine.id : null,
    });

    const row = await queryOne<{ superseded_by: string | null }>(
      `select superseded_by from compliance_item_documents where id = $1`,
      [mine.ok ? mine.id : ""]
    );
    expect(row?.superseded_by).toBeNull();
  });

  it("lists current files before superseded ones", async () => {
    const list = mod.documentsFor(orgId, [itemId]);
    const docs = (await list).get(itemId) ?? [];
    const firstSuperseded = docs.findIndex((doc) => doc.superseded_by !== null);
    if (firstSuperseded !== -1) {
      expect(docs.slice(firstSuperseded).every((doc) => doc.superseded_by !== null)).toBe(true);
    }
  });

  it("removes a mis-filed document and its bytes", async () => {
    const out = await mod.attachDocument({
      orgId, itemId, file: pdf("wrong-item.pdf"), actorId: userId,
    });
    expect(out.ok).toBe(true);
    const path = (await queryOne<{ storage_path: string }>(
      `select storage_path from compliance_item_documents where id = $1`,
      [out.ok ? out.id : ""]
    ))!.storage_path;

    const removed = await mod.removeDocument(orgId, out.ok ? out.id : "", userId);
    expect(removed.ok).toBe(true);

    const gone = await queryOne(
      `select 1 from compliance_item_documents where id = $1`,
      [out.ok ? out.id : ""]
    );
    expect(gone).toBeNull();
    // The bytes too. A row deleted while the blob stayed readable by anybody
    // holding the path would make removal a display change.
    const blob = await queryOne(`select 1 from file_blobs where path = $1`, [path]);
    expect(blob).toBeNull();
  });

  it("will not remove another organization's document", async () => {
    const theirs = await queryOne<{ id: string }>(
      `select id::text as id from compliance_item_documents where org_id = $1 limit 1`,
      [otherOrgId]
    );
    expect(theirs).not.toBeNull();
    const removed = await mod.removeDocument(orgId, theirs!.id, userId);
    expect(removed.ok).toBe(false);
    const still = await queryOne(`select 1 from compliance_item_documents where id = $1`, [
      theirs!.id,
    ]);
    expect(still).not.toBeNull();
  });
});
