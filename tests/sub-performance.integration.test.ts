/**
 * Performance records against a real database.
 *
 * Two rules live in the schema here. A mark against a firm must carry a
 * reason, because one that does not is a mark nobody can check and nobody can
 * lift; and a withdrawal must carry one too, for the same reason read the
 * other way round. Both are check constraints, and a constraint nothing has
 * ever violated is a comment.
 *
 * The third thing worth a real database is the tenant boundary. A performance
 * note is one company's opinion of a subcontractor, and it is exactly the sort
 * of record that must not leak: another company reading "they walked off the
 * Fort Bliss job" would be reading a judgement they were never party to.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("subcontractor performance (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let mod: typeof import("../lib/subcontractor-performance");

  const mine = { id: "" };
  const theirs = { id: "" };
  const sub = { id: "" };
  const theirSub = { id: "" };

  async function makeSub(orgId: string, name: string): Promise<string> {
    const row = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories)
       values ($1,$2,'{Electrical}') returning id`,
      [orgId, `${name}-${randomUUID().slice(0, 8)}`]
    );
    return row!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    mod = await import("../lib/subcontractor-performance");
    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`perf-${randomUUID()}`]
      );
      org.id = o!.id;
    }
    sub.id = await makeSub(mine.id, "Ours");
    theirSub.id = await makeSub(theirs.id, "Theirs");
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from subcontractor_performance_events where org_id=$1`, [org.id]);
      await query(`delete from subcontractors where org_id=$1`, [org.id]);
      await query(`delete from organizations where id=$1`, [org.id]);
    }
  });

  const actor = { actorId: null, actorEmail: "dana@x.invalid" };

  it("records a clean completion without demanding a note", async () => {
    const res = await mod.recordPerformance({
      orgId: mine.id,
      subcontractorId: sub.id,
      kind: "completed",
      ...actor,
    });
    expect(res.ok).toBe(true);
  });

  it("refuses a problem with no reason", async () => {
    const res = await mod.recordPerformance({
      orgId: mine.id,
      subcontractorId: sub.id,
      kind: "issue",
      note: "   ",
      ...actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/check or lift/);
  });

  it("the database refuses one too, without the service", async () => {
    // The check in recordPerformance makes the refusal readable. This is what
    // makes it true.
    await expect(
      query(
        `insert into subcontractor_performance_events (org_id, subcontractor_id, kind)
         values ($1,$2,'issue')`,
        [mine.id, sub.id]
      )
    ).rejects.toThrow();
  });

  it("counts a job with a problem as a job that was done", async () => {
    /*
     * Counting it only as a problem would make a firm with one bad job out of
     * five look identical to one whose only job went wrong.
     */
    const fresh = await makeSub(mine.id, "Counted");
    for (const kind of ["completed", "completed", "completed"] as const) {
      await mod.recordPerformance({ orgId: mine.id, subcontractorId: fresh, kind, ...actor });
    }
    await mod.recordPerformance({
      orgId: mine.id,
      subcontractorId: fresh,
      kind: "issue",
      note: "Left the site unswept and the panel unlabelled.",
      ...actor,
    });
    const counts = await mod.performanceCounts(mine.id, fresh);
    expect(counts.jobsCompleted).toBe(4);
    expect(counts.jobsWithIssues).toBe(1);
    expect(counts.cancellations).toBe(0);
  });

  it("counts a cancellation separately from a job", async () => {
    const fresh = await makeSub(mine.id, "Bailed");
    await mod.recordPerformance({
      orgId: mine.id,
      subcontractorId: fresh,
      kind: "cancelled",
      note: "Pulled out the week before mobilization.",
      ...actor,
    });
    const counts = await mod.performanceCounts(mine.id, fresh);
    expect(counts.cancellations).toBe(1);
    // Backing out is not a job done, and must not read as one.
    expect(counts.jobsCompleted).toBe(0);
  });

  it("withdraws a record without erasing it, and stops counting it", async () => {
    const fresh = await makeSub(mine.id, "Withdrawn");
    const rec = await mod.recordPerformance({
      orgId: mine.id,
      subcontractorId: fresh,
      kind: "issue",
      note: "Wrong crew turned up.",
      ...actor,
    });
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;

    const before = await mod.performanceCounts(mine.id, fresh);
    expect(before.jobsWithIssues).toBe(1);

    const out = await mod.retractPerformance({
      orgId: mine.id,
      eventId: rec.id,
      reason: "It was our scheduling error, not theirs.",
      actorId: null,
    });
    expect(out.ok).toBe(true);

    const after = await mod.performanceCounts(mine.id, fresh);
    // A retracted problem is not a problem. That is the whole point of being
    // able to withdraw it.
    expect(after.jobsWithIssues).toBe(0);

    // And it is still readable, with the reason attached.
    const events = await mod.performanceFor(mine.id, fresh);
    expect(events).toHaveLength(1);
    expect(events[0].retractedAt).toBeTruthy();
    expect(events[0].retractedReason).toMatch(/scheduling error/);
  });

  it("refuses a withdrawal with no reason", async () => {
    const fresh = await makeSub(mine.id, "NoReason");
    const rec = await mod.recordPerformance({
      orgId: mine.id,
      subcontractorId: fresh,
      kind: "issue",
      note: "Late every day.",
      ...actor,
    });
    if (!rec.ok) return;
    const out = await mod.retractPerformance({
      orgId: mine.id,
      eventId: rec.id,
      reason: "  ",
      actorId: null,
    });
    expect(out.ok).toBe(false);
  });

  it("will not withdraw the same record twice", async () => {
    const fresh = await makeSub(mine.id, "Twice");
    const rec = await mod.recordPerformance({
      orgId: mine.id,
      subcontractorId: fresh,
      kind: "cancelled",
      note: "Backed out.",
      ...actor,
    });
    if (!rec.ok) return;
    expect(
      (await mod.retractPerformance({ orgId: mine.id, eventId: rec.id, reason: "Mistake", actorId: null })).ok
    ).toBe(true);
    expect(
      (await mod.retractPerformance({ orgId: mine.id, eventId: rec.id, reason: "Again", actorId: null })).ok
    ).toBe(false);
  });

  it("cannot record against another organization's subcontractor", async () => {
    const res = await mod.recordPerformance({
      orgId: mine.id,
      subcontractorId: theirSub.id,
      kind: "issue",
      note: "Would be a judgement they were never party to.",
      ...actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);

    const leaked = await queryOne<{ n: string }>(
      `select count(*)::text as n from subcontractor_performance_events where subcontractor_id=$1`,
      [theirSub.id]
    );
    expect(leaked?.n).toBe("0");
  });

  it("cannot read another organization's records", async () => {
    await mod.recordPerformance({
      orgId: theirs.id,
      subcontractorId: theirSub.id,
      kind: "issue",
      note: "Theirs alone.",
      actorId: null,
      actorEmail: "them@x.invalid",
    });
    expect(await mod.performanceFor(mine.id, theirSub.id)).toEqual([]);
    const counts = await mod.performanceCounts(mine.id, theirSub.id);
    expect(counts.jobsWithIssues).toBe(0);
  });

  it("cannot withdraw another organization's record", async () => {
    const theirs2 = await mod.recordPerformance({
      orgId: theirs.id,
      subcontractorId: theirSub.id,
      kind: "cancelled",
      note: "Their business.",
      actorId: null,
      actorEmail: "them@x.invalid",
    });
    if (!theirs2.ok) return;
    const out = await mod.retractPerformance({
      orgId: mine.id,
      eventId: theirs2.id,
      reason: "Not mine to withdraw",
      actorId: null,
    });
    expect(out.ok).toBe(false);
    const row = await queryOne<{ retracted_at: Date | null }>(
      `select retracted_at from subcontractor_performance_events where id=$1`,
      [theirs2.id]
    );
    expect(row?.retracted_at).toBeNull();
  });
});
