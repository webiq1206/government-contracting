/**
 * A job whose record was deleted must stop, not retry, and must still be able
 * to say why.
 *
 * bid-builder failed over and over on the same few opportunity ids. Each
 * failure was retried three times with backoff against a record that was never
 * coming back, and when the runner tried to write down what had happened, the
 * log row pointed at the deleted opportunity and the foreign key rejected it.
 * So the job could not succeed, could not usefully retry, and could not even
 * record why it failed. The operator saw churn and no explanation.
 *
 * These tests drive the real runner and the real logger against a real
 * database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("jobs against deleted records (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let runAgent: typeof import("../lib/agents/runner").runAgent;
  let shouldQueueRetry: typeof import("../lib/agents/runner").shouldQueueRetry;
  let logAgent: typeof import("../lib/logger").logAgent;

  const PROBE = "abandon-probe";
  const orgName = `abandon-${randomUUID()}`;
  let orgId = "";
  /** Deleted before the tests run, standing in for an expired opportunity. */
  let deletedOppId = "";
  let liveOppId = "";
  let liveSubId = "";
  let runs = 0;

  function probeAgent() {
    return {
      name: PROBE,
      label: "Abandon probe",
      description: "Records whether the runner let it run at all.",
      worksWithoutClaude: true,
      async handler() {
        runs += 1;
        return { ok: true as const, summary: "probe ran" };
      },
    };
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ runAgent, shouldQueueRetry } = await import("../lib/agents/runner"));
    ({ logAgent } = await import("../lib/logger"));

    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [orgName]
    );
    orgId = org!.id;

    const mkOpp = async (title: string) =>
      (await queryOne<{ id: string }>(
        `insert into opportunities (org_id, source, title, stage, status)
         values ($1, 'test', $2, 'monitoring', 'open') returning id`,
        [orgId, title]
      ))!.id;

    liveOppId = await mkOpp(`${orgName} live`);
    deletedOppId = await mkOpp(`${orgName} deleted`);
    liveSubId = (await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, phone)
       values ($1, $2, '555-0100') returning id`,
      [orgId, `${orgName} sub`]
    ))!.id;
    // Exactly what the expiry sweep does, and what leaves queued jobs behind.
    await query(`delete from opportunities where id = $1`, [deletedOppId]);
  });

  afterAll(async () => {
    await query(`delete from job_runs where agent = $1`, [PROBE]).catch(() => {});
    await query(`delete from agent_logs where agent in ($1, $2)`, [
      PROBE,
      "logger-fk-probe",
    ]).catch(() => {});
    if (orgId) {
      await query(`delete from agent_logs where org_id = $1`, [orgId]).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [orgId]).catch(() => {});
      await query(`delete from subcontractors where org_id = $1`, [orgId]).catch(() => {});
      await query(`delete from organizations where id = $1`, [orgId]).catch(() => {});
    }
  });

  it("stops a job whose opportunity was deleted instead of running it", async () => {
    runs = 0;
    const result = await runAgent(probeAgent(), "queue", { opportunityId: deletedOppId });

    expect(runs).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.permanent).toBe(true);
    expect(result.summary).toContain("no longer exists");
    expect(result.summary).toContain(deletedOppId);
  });

  it("tells the queue not to retry it", async () => {
    // The whole cost of the bug was here: three attempts and backoff each time
    // a dead record came round, on top of the enqueue that started it.
    const abandoned = await runAgent(probeAgent(), "queue", { opportunityId: deletedOppId });
    expect(shouldQueueRetry(abandoned)).toBe(false);
  });

  it("still retries an ordinary failure", async () => {
    // A rate limit or a database blip must keep its retries. Losing those was
    // the risk in this change, and it is the reason the flag is opt in.
    expect(shouldQueueRetry({ ok: false, summary: "Claude rate limited" })).toBe(true);
    expect(shouldQueueRetry({ ok: true, summary: "fine" })).toBe(false);
  });

  it("records the abandonment where the operator can see it", async () => {
    runs = 0;
    await runAgent(probeAgent(), "queue", { opportunityId: deletedOppId });

    const logs = await query<{ message: string | null; status: string }>(
      `select message, status from agent_logs where agent = $1 and action = 'abandoned'`,
      [PROBE]
    );
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].message).toContain(deletedOppId);
    expect(logs[0].message).toContain("not retried");

    const jobRuns = await query<{ status: string; error: string | null }>(
      `select status, error from job_runs where agent = $1`,
      [PROBE]
    );
    expect(jobRuns.length).toBeGreaterThan(0);
    expect(jobRuns.every((r) => r.status === "error")).toBe(true);
    expect(jobRuns[0].error).toContain("no longer exists");
  });

  it("files the abandonment under the organization whose job it was", async () => {
    /**
     * The record that would have answered "whose job is this?" is the record
     * that was deleted, so the queued payload carries the org that enqueued
     * the work. Without it the line lands with no organization, and the
     * Automation Log reads by organization, so the operator sees nothing.
     */
    await runAgent(probeAgent(), "queue", {
      opportunityId: deletedOppId,
      enqueuedByOrgId: orgId,
    });

    const logs = await query<{ org_id: string | null }>(
      `select org_id from agent_logs
        where agent = $1 and action = 'abandoned' and org_id = $2`,
      [PROBE, orgId]
    );
    expect(logs.length).toBeGreaterThan(0);
  });

  it("never lets the enqueuing org overrule the record's own org", async () => {
    // Provenance is a fallback, not an instruction. A live record decides,
    // otherwise a job could be run against the wrong tenant's data.
    runs = 0;
    const otherOrg = randomUUID();
    const result = await runAgent(probeAgent(), "queue", {
      opportunityId: liveOppId,
      enqueuedByOrgId: otherOrg,
    });
    expect(result.ok).toBe(true);
    const logs = await query<{ org_id: string | null }>(
      `select org_id from agent_logs where agent = $1 and action = 'run' and org_id = $2`,
      [PROBE, orgId]
    );
    expect(logs.length).toBeGreaterThan(0);
  });

  it("abandons an id that was never valid rather than retrying it", async () => {
    runs = 0;
    const result = await runAgent(probeAgent(), "queue", { opportunityId: "not-a-uuid" });

    expect(runs).toBe(0);
    expect(result.permanent).toBe(true);
    expect(result.summary).toContain("not a valid id");
  });

  it("leaves a job whose record still exists completely alone", async () => {
    runs = 0;
    const result = await runAgent(probeAgent(), "queue", { opportunityId: liveOppId });

    expect(runs).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.permanent).toBeUndefined();
  });

  it("only ever drops the three record links, never another constraint", async () => {
    // The rescue above is allowed to blank a record link and nothing else. A
    // foreign key failure we do not understand must surface as a failure
    // rather than be blanked until the row inserts and reads as fact.
    const { refColumnForConstraint } = await import("../lib/logger");
    expect(refColumnForConstraint("agent_logs_opportunity_id_fkey")?.key).toBe("opportunityId");
    expect(refColumnForConstraint("agent_logs_subcontractor_id_fkey")?.key).toBe("subcontractorId");
    expect(refColumnForConstraint("agent_logs_bid_id_fkey")?.key).toBe("bidId");
    expect(refColumnForConstraint("agent_logs_org_id_fkey")).toBeNull();
    expect(refColumnForConstraint("bids_opportunity_id_fkey")).toBeNull();
    expect(refColumnForConstraint(undefined)).toBeNull();
  });

  it("writes a log line about a deleted record instead of losing it", async () => {
    /**
     * The failure that mattered most was the one that could not be written
     * down. A line naming a deleted opportunity was refused by the foreign
     * key, so the explanation was discarded for precisely the reason it was
     * worth keeping.
     */
    await logAgent({
      agent: "logger-fk-probe",
      action: "run",
      level: "error",
      status: "error",
      opportunityId: deletedOppId,
      message: "opportunity not found",
    });

    const rows = await query<{ opportunity_id: string | null; message: string | null }>(
      `select opportunity_id, message from agent_logs where agent = 'logger-fk-probe'`
    );
    expect(rows.length).toBe(1);
    // The pointer is dropped, because there is nothing to point at.
    expect(rows[0].opportunity_id).toBeNull();
    // The id survives in the sentence, so the trail still names the record.
    expect(rows[0].message).toContain("opportunity not found");
    expect(rows[0].message).toContain(deletedOppId);
  });

  it("keeps the links that are still good when only one is dangling", async () => {
    // Blanking every link to get the row in would throw away a true part of
    // the trail to save the false one.
    await logAgent({
      agent: "logger-fk-probe",
      action: "run",
      level: "error",
      status: "error",
      opportunityId: deletedOppId,
      subcontractorId: liveSubId,
      message: "mixed refs",
    });

    const rows = await query<{ opportunity_id: string | null; subcontractor_id: string | null }>(
      `select opportunity_id, subcontractor_id from agent_logs
        where agent = 'logger-fk-probe' and message like 'mixed refs%'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].opportunity_id).toBeNull();
    expect(rows[0].subcontractor_id).toBe(liveSubId);
  });

  it("keeps the record link when the record is still there", async () => {
    await logAgent({
      agent: "logger-fk-probe",
      action: "run",
      level: "info",
      opportunityId: liveOppId,
      message: "ordinary line",
    });

    const rows = await query<{ opportunity_id: string | null }>(
      `select opportunity_id from agent_logs
        where agent = 'logger-fk-probe' and message = 'ordinary line'`
    );
    expect(rows[0].opportunity_id).toBe(liveOppId);
  });
});
