/**
 * Bulk roster changes against a real database.
 *
 * The point of these is the undo. Bulk verify, tag and archive were left
 * unbuilt with a note saying a button that changes two hundred rows with no
 * way back is worse than no button, so what has to hold is that the batch
 * records exactly what it changed, that undoing replays only those rows, and
 * that undoing twice refuses.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const queued: { name: string; payload: Record<string, unknown> }[] = [];
let queuePaused = false;
vi.mock("@/lib/queue", () => ({
  enqueue: async (name: string, payload: Record<string, unknown>) => {
    if (queuePaused) return null;
    queued.push({ name, payload });
    return randomUUID();
  },
}));

d("bulk roster changes (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let bulk: typeof import("../lib/sub-bulk");

  const mine = { id: "" };
  const theirs = { id: "" };
  const ids: Record<string, string> = {};

  async function makeSub(key: string, cols: Record<string, unknown> = {}, orgId?: string) {
    const names = Object.keys(cols);
    const row = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name${names.length ? ", " + names.join(", ") : ""})
       values ($1,$2${names.map((_, i) => `, $${i + 3}`).join("")}) returning id`,
      [orgId ?? mine.id, `${key}-${randomUUID().slice(0, 8)}`, ...names.map((n) => cols[n])]
    );
    ids[key] = row!.id;
    return row!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    bulk = await import("../lib/sub-bulk");
    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`bulk-${randomUUID()}`]
      );
      org.id = o!.id;
    }
    await makeSub("checkable", { website: "https://example.test" });
    await makeSub("alsoCheckable", { email: "a@example.test" });
    await makeSub("bare", {});
    await makeSub("blocked", { website: "https://x.test", blacklisted: true, blacklist_reason: "Walked off a job." });
    await makeSub("theirs", { website: "https://y.test" }, theirs.id);
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from subcontractor_bulk_actions where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from subcontractor_tags where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from subcontractors where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
    }
  });

  describe("re-checking contact details", () => {
    it("queues only the firms there is something to check, and names the rest", async () => {
      queued.length = 0;
      const res = await bulk.bulkVerify({
        orgId: mine.id, actorId: null,
        ids: [ids.checkable, ids.alsoCheckable, ids.bare, ids.blocked, ids.theirs],
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.changed).toBe(2);
      expect(queued).toHaveLength(2);
      const reasons = res.skipped.map((s) => s.reason).sort();
      // Each for a different reason, and each reason is one an operator can
      // do something about.
      expect(reasons).toEqual(["blocked", "not_found", "nothing_to_check"]);
      // Another organization's record is "not found", not "forbidden": the
      // two must not be distinguishable.
      expect(res.skipped.find((s) => s.id === ids.theirs)?.reason).toBe("not_found");
    });

    it("does not report a row as queued when the queue refused it", async () => {
      queued.length = 0;
      queuePaused = true;
      const res = await bulk.bulkVerify({
        orgId: mine.id, actorId: null, ids: [ids.checkable, ids.alsoCheckable],
      });
      queuePaused = false;
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // enqueue returns null rather than throwing when automation is paused.
      // Counting those as queued sends somebody looking for results that are
      // never coming.
      expect(res.changed).toBe(0);
      expect(res.skipped.every((s) => s.reason === "automation_paused")).toBe(true);
    });

    it("cannot be undone, and the refusal says why", async () => {
      const res = await bulk.bulkVerify({ orgId: mine.id, actorId: null, ids: [ids.checkable] });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.batchId) return;
      const undo = await bulk.undoBulk({ orgId: mine.id, batchId: res.batchId, actorId: null });
      expect(undo.ok).toBe(false);
      if (undo.ok) return;
      expect(undo.error).toMatch(/older/);
    });
  });

  describe("tagging", () => {
    it("treats one tag typed two ways as one tag", async () => {
      await bulk.bulkTag({ orgId: mine.id, actorId: null, ids: [ids.bare], tag: "Preferred HVAC" });
      const second = await bulk.bulkTag({
        orgId: mine.id, actorId: null, ids: [ids.bare], tag: "preferred hvac",
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      // Already carrying it, so nothing changed and the batch says so.
      expect(second.changed).toBe(0);
      expect(await bulk.tagsOf(mine.id, ids.bare)).toEqual(["Preferred HVAC"]);
    });

    it("undoes exactly the rows it changed, not the rows it was given", async () => {
      // Pre-tag one of them, so the batch changes one row out of two.
      await bulk.bulkTag({ orgId: mine.id, actorId: null, ids: [ids.checkable], tag: "Shortlist" });
      const res = await bulk.bulkTag({
        orgId: mine.id, actorId: null,
        ids: [ids.checkable, ids.alsoCheckable], tag: "Shortlist",
      });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.batchId) return;
      expect(res.changed).toBe(1);

      const undo = await bulk.undoBulk({ orgId: mine.id, batchId: res.batchId, actorId: null });
      expect(undo.ok).toBe(true);
      if (!undo.ok) return;
      expect(undo.restored).toBe(1);
      /*
       * The one that already had the tag keeps it. Undoing by the selection
       * rather than by what changed would have stripped a tag this batch
       * never added.
       */
      expect(await bulk.tagsOf(mine.id, ids.checkable)).toContain("Shortlist");
      expect(await bulk.tagsOf(mine.id, ids.alsoCheckable)).not.toContain("Shortlist");
    });

    it("refuses to undo the same batch twice", async () => {
      const res = await bulk.bulkTag({ orgId: mine.id, actorId: null, ids: [ids.bare], tag: "Twice" });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.batchId) return;
      expect((await bulk.undoBulk({ orgId: mine.id, batchId: res.batchId, actorId: null })).ok).toBe(true);
      const again = await bulk.undoBulk({ orgId: mine.id, batchId: res.batchId, actorId: null });
      expect(again.ok).toBe(false);
      if (again.ok) return;
      // A second undo would strip a tag somebody deliberately re-added, which
      // is the failure an undo exists to prevent rather than cause.
      expect(again.error).toMatch(/already been taken back/);
    });

    it("cannot tag another organization's record", async () => {
      const res = await bulk.bulkTag({
        orgId: mine.id, actorId: null, ids: [ids.theirs], tag: "Intruder",
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.changed).toBe(0);
      expect(await bulk.tagsOf(theirs.id, ids.theirs)).toEqual([]);
    });
  });

  describe("putting several aside", () => {
    it("needs a reason", async () => {
      const res = await bulk.bulkArchive({
        orgId: mine.id, actorId: null, ids: [ids.bare], reason: "  ",
      });
      expect(res.ok).toBe(false);
    });

    it("archives, and brings back exactly what it archived", async () => {
      const a = await makeSub("archiveA");
      const b = await makeSub("archiveB", { archived_at: new Date(), archived_reason: "Already aside" });
      const res = await bulk.bulkArchive({
        orgId: mine.id, actorId: null, ids: [a, b], reason: "Out of the working area.",
      });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.batchId) return;
      // The one already put aside is left alone rather than having its reason
      // overwritten with this batch's.
      expect(res.changed).toBe(1);

      const undo = await bulk.undoBulk({ orgId: mine.id, batchId: res.batchId, actorId: null });
      expect(undo.ok).toBe(true);
      const rows = await query<{ id: string; archived_reason: string | null }>(
        `select id, archived_reason from subcontractors where id = any($1::uuid[])`,
        [[a, b]]
      );
      expect(rows.find((r) => r.id === a)?.archived_reason).toBeNull();
      expect(rows.find((r) => r.id === b)?.archived_reason).toBe("Already aside");
    });
  });

  it("refuses a batch too large to have been read", async () => {
    const many = Array.from({ length: 501 }, () => randomUUID());
    const res = await bulk.bulkTag({ orgId: mine.id, actorId: null, ids: many, tag: "Huge" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/more than 500/);
  });

  it("refuses an empty selection rather than reporting a successful no-op", async () => {
    const res = await bulk.bulkTag({ orgId: mine.id, actorId: null, ids: [], tag: "None" });
    expect(res.ok).toBe(false);
  });
});
