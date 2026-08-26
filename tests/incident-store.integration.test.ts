/**
 * Incidents in the database, and the rules that hold there.
 *
 * The lifecycle itself is pure and tested without a database. What can only be
 * tested against a real one is that the rules survive contact with Postgres:
 * that a second assessment during the same outage updates one incident rather
 * than opening a second, that "recovered" cannot be written without a recovery
 * time, and that one organization's outage is invisible to another.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("storing an incident", () => {
  let query: typeof import("../lib/db").query;
  let store: typeof import("../lib/incidents");

  const orgA = randomUUID();
  const orgB = randomUUID();
  const NINE = new Date("2026-08-26T09:00:00Z");
  const THREE = new Date("2026-08-26T15:00:00Z");

  const open = (orgId: string, over: Record<string, unknown> = {}) =>
    store.openOrUpdateIncident({
      orgId,
      cause: "provider_credit",
      severity: "blocking",
      provider: "anthropic",
      startedAt: NINE,
      failedCount: 12,
      recommendedAction: "Add credit to the provider account.",
      ...over,
    });

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    store = await import("../lib/incidents");
    for (const [id, name] of [[orgA, "Incident A"], [orgB, "Incident B"]] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }
  });

  afterEach(async () => {
    await query(`delete from automation_incidents where org_id = any($1::uuid[])`, [[orgA, orgB]]);
  });

  afterAll(async () => {
    await query(`delete from organizations where id = any($1::uuid[])`, [[orgA, orgB]]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("opens one incident and keeps updating it, not opening more", async () => {
    /*
     * Every assessment that runs while the provider is down would otherwise
     * open another incident for the same outage, and the recovery button would
     * have to guess which one it was recovering.
     */
    const first = await open(orgA);
    const second = await open(orgA, { failedCount: 340 });
    expect(second.id).toBe(first.id);
    expect(second.failedCount).toBe(340);
    const all = await store.openIncidents(orgA);
    expect(all).toHaveLength(1);
  });

  it("keeps the earliest start time, not the latest", async () => {
    // An outage that began at nine and is still going at three did not start
    // at three, and elapsed time is the number an operator decides on.
    await open(orgA, { startedAt: NINE });
    const later = await open(orgA, { startedAt: THREE });
    expect(later.startedAt.toISOString()).toBe(NINE.toISOString());
  });

  it("keeps one organization's outage invisible to another", async () => {
    await open(orgA);
    expect(await store.openIncidents(orgB)).toEqual([]);
    const mine = await store.openIncidents(orgA);
    expect(await store.incidentById(mine[0].id, orgB)).toBeNull();
  });

  it("lets a new outage open a new incident once the old one recovered", async () => {
    /*
     * The unique index is partial for this reason. A later outage is a new
     * incident: merging them would lose the fact that the first was fixed,
     * which is the fact somebody wants when it happens a third time.
     */
    const first = await open(orgA);
    await store.advance({ incidentId: first.id, orgId: orgA, to: "provider_restored", actor: "test" });
    await store.advance({ incidentId: first.id, orgId: orgA, to: "test_passed", actor: "test" });
    await store.advance({ incidentId: first.id, orgId: orgA, to: "recovered", actor: "test" });

    const second = await open(orgA);
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe("detected");
  });

  it("refuses an illegal transition rather than performing it", async () => {
    const inc = await open(orgA);
    await expect(
      store.advance({ incidentId: inc.id, orgId: orgA, to: "recovered", actor: "test" })
    ).rejects.toThrow(/cannot go from detected to recovered/);
    expect((await store.incidentById(inc.id, orgA))?.state).toBe("detected");
  });

  it("stamps a recovery time whenever it records a recovery", async () => {
    // A check constraint refuses the row without one, so a caller who forgot
    // would get a constraint violation instead of a recovery.
    const inc = await open(orgA);
    await store.advance({ incidentId: inc.id, orgId: orgA, to: "provider_restored", actor: "t" });
    await store.advance({ incidentId: inc.id, orgId: orgA, to: "test_passed", actor: "t" });
    const done = await store.advance({
      incidentId: inc.id,
      orgId: orgA,
      to: "recovered",
      actor: "t",
      set: { recoveryNote: "Scoring ran and wrote a score." },
    });
    expect(done.recoveredAt).toBeInstanceOf(Date);
    expect(done.recoveryNote).toContain("wrote a score");
    expect(await store.openIncidents(orgA)).toEqual([]);
  });

  it("records who did what, in order", async () => {
    /*
     * "test failed, then passed" and "test passed" are different stories about
     * the same final row, and only the history can tell them apart.
     */
    const inc = await open(orgA);
    await store.advance({
      incidentId: inc.id, orgId: orgA, to: "provider_restored",
      actor: "info@webiq.co", detail: "Credit added.",
    });
    await store.advance({
      incidentId: inc.id, orgId: orgA, to: "recovery_failed",
      actor: "recovery-check", detail: "Test request still refused.",
    });
    await store.advance({
      incidentId: inc.id, orgId: orgA, to: "provider_restored", actor: "info@webiq.co",
    });
    const history = await store.incidentHistory(inc.id, orgA);
    expect(history.map((h) => h.toState)).toEqual([
      "provider_restored",
      "recovery_failed",
      "provider_restored",
    ]);
    expect(history[0].actor).toBe("info@webiq.co");
    expect(history[1].detail).toContain("still refused");
    expect(history[0].fromState).toBe("detected");
  });

  it("counts a repair attempt on each test, passed or failed", async () => {
    // A recovery on its fourth attempt is telling somebody that retrying is
    // not the answer, and a counter that only records successes cannot.
    const inc = await open(orgA);
    await store.advance({ incidentId: inc.id, orgId: orgA, to: "provider_restored", actor: "t" });
    await store.advance({ incidentId: inc.id, orgId: orgA, to: "recovery_failed", actor: "t" });
    await store.advance({ incidentId: inc.id, orgId: orgA, to: "provider_restored", actor: "t" });
    const after = await store.advance({
      incidentId: inc.id, orgId: orgA, to: "test_passed", actor: "t",
    });
    expect(after.repairAttempts).toBe(2);
  });

  it("keeps a test that has not run apart from a test that failed", async () => {
    /*
     * Null and false are different facts. A UI that reads "no test yet" as
     * "test failed" tells somebody their provider is broken when nothing has
     * asked it anything.
     */
    const inc = await open(orgA);
    expect(inc.testPassed).toBeNull();
    expect(inc.testRanAt).toBeNull();
    const failed = await store.advance({
      incidentId: inc.id, orgId: orgA, to: "recovery_failed", actor: "t",
      set: { testRanAt: new Date(), testPassed: false, testDetail: "402 payment required" },
    });
    expect(failed.testPassed).toBe(false);
    expect(failed.testRanAt).toBeInstanceOf(Date);
  });

  it("is a no-op when asked to move somewhere it already is", async () => {
    const inc = await open(orgA);
    const same = await store.advance({ incidentId: inc.id, orgId: orgA, to: "detected", actor: "t" });
    expect(same.state).toBe("detected");
    expect(await store.incidentHistory(inc.id, orgA)).toEqual([]);
  });

  it("refuses to advance an incident belonging to another organization", async () => {
    const inc = await open(orgA);
    await expect(
      store.advance({ incidentId: inc.id, orgId: orgB, to: "mitigating", actor: "t" })
    ).rejects.toThrow(/No such incident/);
  });
});
