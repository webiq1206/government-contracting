/**
 * Merging duplicate subcontractors, against a real database.
 *
 * The property this file exists to protect is that a merge loses nothing. The
 * only tool for a duplicate used to be deleting one, which takes its emails,
 * quotes, pairings, documents and compliance records with it, and those are the
 * record of who was approached for a federal bid.
 *
 * The most valuable test here is the one that reads the database's own catalog
 * and checks the merge repoints every column that references a subcontractor.
 * A fifteenth table added next month would otherwise silently lose its history,
 * and nothing about the merge would look wrong.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("subcontractor merge (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let mod: typeof import("../lib/subcontractor-merge");

  const mine = { id: "" };
  const theirs = { id: "" };
  const opp = { id: "" };

  async function makeSub(orgId: string, name: string, over: Record<string, unknown> = {}) {
    const row = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, email, phone)
       values ($1,$2,'{Electrical}',$3,$4) returning id`,
      [orgId, `${name}-${randomUUID().slice(0, 8)}`, over.email ?? null, over.phone ?? null]
    );
    return row!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    mod = await import("../lib/subcontractor-merge");
    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`merge-${randomUUID()}`]
      );
      org.id = o!.id;
    }
    const o = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1,'test','Fort Bliss HVAC','outreach','open', now() + interval '30 days') returning id`,
      [mine.id]
    );
    opp.id = o!.id;
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from subcontractor_merges where org_id=$1`, [org.id]);
      await query(`delete from communications where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from opportunities where org_id=$1`, [org.id]);
      await query(`update subcontractors set merged_into = null where org_id=$1`, [org.id]);
      await query(`delete from subcontractors where org_id=$1`, [org.id]);
      await query(`delete from organizations where id=$1`, [org.id]);
    }
  });

  it("knows about every column that points at a subcontractor", async () => {
    /*
     * Read from the catalog rather than from a list in the code, so a table
     * added next month is repointed automatically. This asserts the query
     * actually finds them, because a query that silently returned nothing
     * would make every merge a no-op that looked like a success.
     */
    const tables = await mod.subcontractorChildTables();
    const names = tables.map((t) => `${t.table}.${t.column}`);
    for (const expected of [
      "communications.subcontractor_id",
      "quotes.subcontractor_id",
      "opportunity_subs.subcontractor_id",
      "subcontractor_documents.subcontractor_id",
      "subcontractor_performance_events.subcontractor_id",
      "call_cards.subcontractor_id",
      "contracts.primary_sub_id",
      "trade_pricing_rows.selected_sub_id",
    ]) {
      expect(names).toContain(expected);
    }
    // And it must not try to move the tombstone pointer the merge writes.
    expect(names).not.toContain("subcontractors.merged_into");
  });

  it("moves the history and deletes nothing", async () => {
    const keep = await makeSub(mine.id, "Ridgeline", { phone: "915-555-0100" });
    const dupe = await makeSub(mine.id, "RidgelineLLC", { email: "bids@ridge.invalid" });

    for (let i = 0; i < 3; i++) {
      await query(
        `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject)
         values ($1,$2,$3,'email','outbound',$4)`,
        [mine.id, dupe, opp.id, `Quote request ${i}`]
      );
    }
    await query(
      `insert into subcontractor_performance_events (org_id, subcontractor_id, kind, note)
       values ($1,$2,'issue','Left the panel unlabelled.')`,
      [mine.id, dupe]
    );

    const plan = await mod.planMerge(mine.id, keep, dupe);
    expect(plan).toBeTruthy();
    expect(plan!.totalMoving).toBeGreaterThanOrEqual(4);
    expect(plan!.reversible).toBe(true);

    const res = await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: keep,
      mergedId: dupe,
      actorId: null,
      actorEmail: "dana@x.invalid",
    });
    expect(res.ok).toBe(true);

    const moved = await queryOne<{ n: string }>(
      `select count(*)::text as n from communications where subcontractor_id=$1`,
      [keep]
    );
    expect(moved?.n).toBe("3");

    // The losing record is still there, pointing at the survivor.
    const tomb = await queryOne<{ merged_into: string; archived_at: Date | null }>(
      `select merged_into, archived_at from subcontractors where id=$1`,
      [dupe]
    );
    expect(tomb?.merged_into).toBe(keep);
    expect(tomb?.archived_at).toBeTruthy();
  });

  it("keeps the survivor's value unless told otherwise", async () => {
    const keep = await makeSub(mine.id, "KeepMine", { phone: "915-555-0111" });
    const dupe = await makeSub(mine.id, "DropMine", { phone: "915-555-0222" });

    await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: keep,
      mergedId: dupe,
      actorId: null,
      actorEmail: null,
    });
    const row = await queryOne<{ phone: string }>(
      `select phone from subcontractors where id=$1`,
      [keep]
    );
    // A merge that silently preferred the newer record could overwrite a
    // number somebody corrected by hand.
    expect(row?.phone).toBe("915-555-0111");
  });

  it("takes the other value when asked", async () => {
    const keep = await makeSub(mine.id, "NoPhone");
    const dupe = await makeSub(mine.id, "HasPhone", { phone: "915-555-0333" });

    await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: keep,
      mergedId: dupe,
      keep: { phone: "merged" },
      actorId: null,
      actorEmail: null,
    });
    const row = await queryOne<{ phone: string }>(
      `select phone from subcontractors where id=$1`,
      [keep]
    );
    expect(row?.phone).toBe("915-555-0333");
  });

  it("does not fail the whole merge over a colliding pairing", async () => {
    const keep = await makeSub(mine.id, "PairedKeep");
    const dupe = await makeSub(mine.id, "PairedDupe");
    for (const id of [keep, dupe]) {
      await query(
        `insert into opportunity_subs (opportunity_id, subcontractor_id, trade)
         values ($1,$2,'Electrical')`,
        [opp.id, id]
      );
    }

    const plan = await mod.planMerge(mine.id, keep, dupe);
    const pairRow = plan!.rows.find((r) => r.table === "opportunity_subs");
    expect(pairRow?.colliding).toBe(1);

    const res = await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: keep,
      mergedId: dupe,
      actorId: null,
      actorEmail: null,
    });
    expect(res.ok).toBe(true);

    // The survivor keeps exactly one pairing for the trade, and the loser's is
    // still readable on the tombstone rather than deleted.
    const survivorPairs = await queryOne<{ n: string }>(
      `select count(*)::text as n from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2`,
      [opp.id, keep]
    );
    expect(survivorPairs?.n).toBe("1");
    const loserPairs = await queryOne<{ n: string }>(
      `select count(*)::text as n from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2`,
      [opp.id, dupe]
    );
    expect(loserPairs?.n).toBe("1");
  });

  it("puts a merge back, history and all", async () => {
    const keep = await makeSub(mine.id, "UndoKeep");
    const dupe = await makeSub(mine.id, "UndoDupe");
    for (let i = 0; i < 2; i++) {
      await query(
        `insert into communications (org_id, subcontractor_id, channel, direction, subject)
         values ($1,$2,'email','outbound',$3)`,
        [mine.id, dupe, `Undo ${i}`]
      );
    }

    const res = await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: keep,
      mergedId: dupe,
      actorId: null,
      actorEmail: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const back = await mod.undoMerge({ orgId: mine.id, mergeId: res.mergeId, actorId: null });
    expect(back.ok).toBe(true);

    const returned = await queryOne<{ n: string }>(
      `select count(*)::text as n from communications where subcontractor_id=$1`,
      [dupe]
    );
    expect(returned?.n).toBe("2");
    const row = await queryOne<{ merged_into: string | null; archived_at: Date | null }>(
      `select merged_into, archived_at from subcontractors where id=$1`,
      [dupe]
    );
    expect(row?.merged_into).toBeNull();
    expect(row?.archived_at).toBeNull();
  });

  it("will not undo the same merge twice", async () => {
    const keep = await makeSub(mine.id, "TwiceKeep");
    const dupe = await makeSub(mine.id, "TwiceDupe");
    const res = await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: keep,
      mergedId: dupe,
      actorId: null,
      actorEmail: null,
    });
    if (!res.ok) return;
    expect((await mod.undoMerge({ orgId: mine.id, mergeId: res.mergeId, actorId: null })).ok).toBe(
      true
    );
    expect((await mod.undoMerge({ orgId: mine.id, mergeId: res.mergeId, actorId: null })).ok).toBe(
      false
    );
  });

  it("refuses to merge a record that is already folded into another", async () => {
    const a = await makeSub(mine.id, "ChainA");
    const b = await makeSub(mine.id, "ChainB");
    const c = await makeSub(mine.id, "ChainC");
    await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: a,
      mergedId: b,
      actorId: null,
      actorEmail: null,
    });
    const second = await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: c,
      mergedId: b,
      actorId: null,
      actorEmail: null,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);
  });

  it("cannot merge across organizations", async () => {
    const ours = await makeSub(mine.id, "Ours");
    const theirSub = await makeSub(theirs.id, "Theirs");

    expect(await mod.planMerge(mine.id, ours, theirSub)).toBeNull();
    const res = await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: ours,
      mergedId: theirSub,
      actorId: null,
      actorEmail: null,
    });
    expect(res.ok).toBe(false);

    const untouched = await queryOne<{ merged_into: string | null }>(
      `select merged_into from subcontractors where id=$1`,
      [theirSub]
    );
    expect(untouched?.merged_into).toBeNull();
  });

  it("archives with a reason and brings back", async () => {
    const s = await makeSub(mine.id, "Aside");
    expect(
      (await mod.archiveSubcontractor({ orgId: mine.id, subcontractorId: s, reason: "  ", actorId: null }))
        .ok
    ).toBe(false);

    expect(
      (
        await mod.archiveSubcontractor({
          orgId: mine.id,
          subcontractorId: s,
          reason: "Retired, the owner sold up.",
          actorId: null,
        })
      ).ok
    ).toBe(true);

    const row = await queryOne<{ archived_reason: string }>(
      `select archived_reason from subcontractors where id=$1`,
      [s]
    );
    expect(row?.archived_reason).toMatch(/sold up/);

    expect((await mod.restoreSubcontractor({ orgId: mine.id, subcontractorId: s })).ok).toBe(true);
  });

  it("blocks with a reason, and refuses one without", async () => {
    const s = await makeSub(mine.id, "Blocked");
    // Two characters is not a reason. Enforced here and in the database, so a
    // caller that bypasses this module still cannot leave a bare block behind.
    expect(
      (await mod.blockSubcontractor({ orgId: mine.id, subcontractorId: s, reason: "ab", actorId: null }))
        .ok
    ).toBe(false);

    expect(
      (
        await mod.blockSubcontractor({
          orgId: mine.id,
          subcontractorId: s,
          reason: "Walked off the Fort Bliss job with two weeks left.",
          actorId: null,
        })
      ).ok
    ).toBe(true);

    const row = await queryOne<{ blacklisted: boolean; blacklist_reason: string; blacklisted_at: string }>(
      `select blacklisted, blacklist_reason, blacklisted_at from subcontractors where id=$1`,
      [s]
    );
    expect(row?.blacklisted).toBe(true);
    expect(row?.blacklist_reason).toMatch(/Fort Bliss/);
    expect(row?.blacklisted_at).toBeTruthy();
  });

  it("will not let the database hold a block with no reason behind it", async () => {
    const s = await makeSub(mine.id, "BareBlock");
    /*
     * The constraint, not the service. A bare block is one nobody can lift
     * with any confidence, and the roster used to be full of them because
     * `blacklisted` was a boolean anyone could set in SQL.
     */
    await expect(
      query(`update subcontractors set blacklisted = true where id = $1`, [s])
    ).rejects.toThrow(/blacklist_reason_ck/);
  });

  it("clears the reason when the block is lifted, so nothing reads as blocked afterwards", async () => {
    const s = await makeSub(mine.id, "Lifted");
    await mod.blockSubcontractor({
      orgId: mine.id,
      subcontractorId: s,
      reason: "Priced two jobs and did neither.",
      actorId: null,
    });
    expect((await mod.unblockSubcontractor({ orgId: mine.id, subcontractorId: s })).ok).toBe(true);
    const row = await queryOne<{ blacklisted: boolean; blacklist_reason: string | null }>(
      `select blacklisted, blacklist_reason from subcontractors where id=$1`,
      [s]
    );
    expect(row?.blacklisted).toBe(false);
    expect(row?.blacklist_reason).toBeNull();

    // Not blocked is not the same as never blocked: lifting twice is a 404,
    // so a stray second click cannot read as having done something.
    expect((await mod.unblockSubcontractor({ orgId: mine.id, subcontractorId: s })).ok).toBe(false);
  });

  it("cannot block another organization's record", async () => {
    const notMine = await makeSub(theirs.id, "TheirFirm");
    const res = await mod.blockSubcontractor({
      orgId: mine.id,
      subcontractorId: notMine,
      reason: "Should never take effect.",
      actorId: null,
    });
    expect(res.ok).toBe(false);
    const row = await queryOne<{ blacklisted: boolean }>(
      `select blacklisted from subcontractors where id=$1`,
      [notMine]
    );
    expect(row?.blacklisted).toBe(false);
  });

  it("will not restore a merged record without undoing the merge", async () => {
    const keep = await makeSub(mine.id, "RestoreKeep");
    const dupe = await makeSub(mine.id, "RestoreDupe");
    await mod.mergeSubcontractors({
      orgId: mine.id,
      survivorId: keep,
      mergedId: dupe,
      actorId: null,
      actorEmail: null,
    });
    const res = await mod.restoreSubcontractor({ orgId: mine.id, subcontractorId: dupe });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Restoring alone would leave a record on the roster with none of its own
    // history, which reads as a firm nobody has ever dealt with.
    expect(res.error).toMatch(/Undo the merge/);
  });

  it("the database refuses an archive with no reason", async () => {
    const s = await makeSub(mine.id, "NoReasonArchive");
    await expect(
      query(`update subcontractors set archived_at = now() where id=$1`, [s])
    ).rejects.toThrow();
  });

  it("the database refuses a merge pointer that is not archived", async () => {
    const a = await makeSub(mine.id, "PtrA");
    const b = await makeSub(mine.id, "PtrB");
    await expect(
      query(`update subcontractors set merged_into = $2 where id=$1`, [b, a])
    ).rejects.toThrow();
  });
});
