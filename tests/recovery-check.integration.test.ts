/**
 * Run recovery check, against a real database and a stubbed provider.
 *
 * The instructions name the scenarios, and every one of them is a way a
 * recovery can look successful while being nothing of the kind: the provider
 * is funded but still refusing, the test passes but the backlog is untouched,
 * the button is pressed twice, or work replays that should never have replayed.
 *
 * The provider itself is stubbed because the point is not whether Anthropic
 * answers, it is what this code does with either answer.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

/** What the stubbed provider does on the next call. */
let PROVIDER: { ok: boolean; error?: unknown } = { ok: true };
vi.mock("../lib/ai/claude", async (orig) => ({
  ...(await orig<typeof import("../lib/ai/claude")>()),
  complete: async () => {
    if (!PROVIDER.ok) throw PROVIDER.error;
    return { text: "ready", usage: { input_tokens: 4, output_tokens: 1 }, stopReason: "end_turn" };
  },
}));

/** Jobs the recovery enqueued, so the test can see what it asked for. */
const ENQUEUED: { name: string; payload: Record<string, unknown> }[] = [];
let QUEUE_ACCEPTS = true;
vi.mock("../lib/queue", async (orig) => ({
  ...(await orig<typeof import("../lib/queue")>()),
  enqueue: async (name: string, payload: Record<string, unknown>) => {
    if (!QUEUE_ACCEPTS) return null;
    ENQUEUED.push({ name, payload });
    return `job-${ENQUEUED.length}`;
  },
}));

d("run recovery check", () => {
  let query: typeof import("../lib/db").query;
  let store: typeof import("../lib/incidents");
  let runRecoveryCheck: typeof import("../lib/recovery").runRecoveryCheck;
  let reconcileDraining: typeof import("../lib/recovery").reconcileDraining;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const OUTAGE_START = new Date(Date.now() - 6 * 3_600_000);

  async function seedFailure(over: {
    agent?: string;
    error?: string;
    opportunityId?: string | null;
    orgId?: string;
    status?: string;
    at?: Date;
  } = {}) {
    const row = await query<{ id: string }>(
      `insert into job_runs (agent, trigger, status, org_id, opportunity_id, error, started_at)
       values ($1,'schedule',$2,$3,$4,$5,$6) returning id`,
      [
        over.agent ?? "scoring-engine",
        over.status ?? "error",
        over.orgId ?? org,
        over.opportunityId ?? null,
        over.error ?? "Your credit balance is too low to access the API",
        over.at ?? new Date(OUTAGE_START.getTime() + 60_000),
      ]
    );
    return row[0].id;
  }

  const openIncident = () =>
    store.openOrUpdateIncident({
      orgId: org,
      cause: "provider_credit",
      severity: "blocking",
      provider: "anthropic",
      startedAt: OUTAGE_START,
      failedCount: 0,
      recommendedAction: "Add credit at console.anthropic.com.",
    });

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    store = await import("../lib/incidents");
    ({ runRecoveryCheck, reconcileDraining } = await import("../lib/recovery"));
    for (const [id, name] of [[org, "Recovery A"], [otherOrg, "Recovery B"]] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }
  });

  beforeEach(async () => {
    PROVIDER = { ok: true };
    QUEUE_ACCEPTS = true;
    ENQUEUED.length = 0;
    await query(`delete from automation_incidents where org_id = any($1::uuid[])`, [[org, otherOrg]]);
    await query(`delete from job_runs where org_id = any($1::uuid[])`, [[org, otherOrg]]);
  });

  afterAll(async () => {
    await query(`delete from job_runs where org_id = any($1::uuid[])`, [[org, otherOrg]]).catch(() => {});
    await query(`delete from automation_incidents where org_id = any($1::uuid[])`, [[org, otherOrg]]).catch(() => {});
    await query(`delete from organizations where id = any($1::uuid[])`, [[org, otherOrg]]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("refuses to requeue anything when the provider is still refusing", async () => {
    /*
     * The scenario the instructions call out: provider restored but test run
     * fails. Requeueing four hundred jobs into a provider that still says no
     * turns one incident into four hundred more failures.
     */
    PROVIDER = {
      ok: false,
      error: Object.assign(new Error("credit balance is too low"), { status: 400 }),
    };
    await seedFailure();
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");

    expect(result.test.passed).toBe(false);
    expect(result.requeued).toBe(0);
    expect(ENQUEUED).toHaveLength(0);
    expect(result.state).toBe("recovery_failed");
    // The operator-facing sentence names the account problem, not a stack trace.
    expect(result.message).toContain("credit balance");
  });

  it("requeues eligible work once the provider answers", async () => {
    await seedFailure({ agent: "scoring-engine" });
    await seedFailure({ agent: "solicitation-analyst" });
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");

    expect(result.test.passed).toBe(true);
    expect(result.requeued).toBe(2);
    expect(ENQUEUED.map((e) => e.name).sort()).toEqual(["scoring-engine", "solicitation-analyst"]);
    expect(result.state).toBe("backlog_draining");
  });

  it("does not duplicate work when the button is pressed twice", async () => {
    /*
     * The idempotency key is claimed before the job is enqueued, so a second
     * press finds the row already there and enqueues nothing.
     */
    await seedFailure();
    const inc = await openIncident();
    const first = await runRecoveryCheck(inc.id, org, "op@probe.invalid");
    ENQUEUED.length = 0;
    const second = await runRecoveryCheck(inc.id, org, "op@probe.invalid");

    expect(first.requeued).toBe(1);
    expect(second.requeued).toBe(0);
    expect(ENQUEUED).toHaveLength(0);
    const rows = await query(`select id from incident_requeues where incident_id = $1`, [inc.id]);
    expect(rows).toHaveLength(1);
  });

  it("has an index that refuses a duplicate requeue key outright", async () => {
    /*
     * Two guards stop the same job being requeued twice, and they cover
     * different things.
     *
     * The sequential double-press above is caught by the eligibility check
     * seeing the requeue row from the first press. That is the one that fires
     * in practice, and it means the idempotency key itself is never exercised
     * by that test: removing the key does not fail it.
     *
     * The key is the backstop for the case the eligibility check cannot see,
     * which is two writes racing between the read and the insert. Provoking
     * that race through the whole flow is not something these awaits can do
     * reliably, so this asserts the property the backstop rests on rather than
     * pretending to reproduce the timing.
     */
    const inc = await openIncident();
    const key = `recovery:${inc.id}:duplicate-probe`;
    const insert = () =>
      query(
        `insert into incident_requeues
           (incident_id, org_id, agent, idempotency_key, outcome)
         values ($1,$2,'scoring-engine',$3,'queued')`,
        [inc.id, org, key]
      );
    await insert();
    await expect(insert()).rejects.toThrow(/incident_requeues_key_idx|duplicate key/);

    // And the same insert with `on conflict do nothing` claims nothing the
    // second time, which is what the recovery relies on.
    const claimed = await query<{ id: string }>(
      `insert into incident_requeues
         (incident_id, org_id, agent, idempotency_key, outcome)
       values ($1,$2,'scoring-engine',$3,'queued')
       on conflict (idempotency_key) do nothing
       returning id`,
      [inc.id, org, key]
    );
    expect(claimed).toEqual([]);
  });

  it("never replays outward-facing work in bulk", async () => {
    // A second email in a subcontractor's inbox is not recoverable by
    // apologising, and the failure could have been after the message left.
    await seedFailure({ agent: "outreach" });
    await seedFailure({ agent: "outreach-followup" });
    await seedFailure({ agent: "scoring-engine" });
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");

    expect(ENQUEUED.map((e) => e.name)).toEqual(["scoring-engine"]);
    expect(result.plan).toContain("could send something twice");
  });

  it("does not replay a failure that had a different cause", async () => {
    /*
     * A job that failed on a bad API key during a credit outage will fail
     * again on the bad API key, and requeueing it makes the backlog look like
     * it is not draining when it is.
     */
    await seedFailure({ error: "401 authentication_error: invalid x-api-key" });
    await seedFailure({ error: "Your credit balance is too low" });
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");

    expect(result.requeued).toBe(1);
    expect(result.plan).toContain("failed for a different reason");
  });

  it("does not replay work a later successful run already did", async () => {
    const opp = randomUUID();
    await query(
      `insert into opportunities (id, org_id, title, source, stage)
       values ($1,$2,'Recovery probe','test','scoring')`,
      [opp, org]
    );
    await seedFailure({ opportunityId: opp, at: new Date(OUTAGE_START.getTime() + 60_000) });
    await seedFailure({
      opportunityId: opp,
      status: "ok",
      error: undefined,
      at: new Date(OUTAGE_START.getTime() + 120_000),
    });
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");

    expect(result.requeued).toBe(0);
    expect(result.plan).toContain("a later run already did this work");
    await query(`delete from opportunities where id = $1`, [opp]);
  });

  it("does not replay work for a pursuit the operator stopped", async () => {
    const opp = randomUUID();
    await query(
      `insert into opportunities (id, org_id, title, source, stage, pursuit_state)
       values ($1,$2,'Stopped probe','test','scoring','aborted')`,
      [opp, org]
    );
    await seedFailure({ opportunityId: opp });
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");

    expect(result.requeued).toBe(0);
    expect(result.plan).toContain("this pursuit has been stopped");
    await query(`delete from opportunities where id = $1`, [opp]);
  });

  it("does not replay work whose deadline has already passed", async () => {
    const opp = randomUUID();
    await query(
      `insert into opportunities (id, org_id, title, source, stage, deadline)
       values ($1,$2,'Expired probe','test','scoring', now() - interval '2 days')`,
      [opp, org]
    );
    await seedFailure({ opportunityId: opp });
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");

    expect(result.requeued).toBe(0);
    expect(result.plan).toContain("the deadline has already passed");
    await query(`delete from opportunities where id = $1`, [opp]);
  });

  it("never touches another organization's failures", async () => {
    await seedFailure({ orgId: otherOrg });
    await seedFailure({ orgId: org });
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");
    expect(result.requeued).toBe(1);
  });

  it("stays open when the test passes but the backlog has not drained", async () => {
    /*
     * The scenario worth the most: provider test passes but backlog remains.
     * A green test is not a recovery, and an incident that closed here would
     * take the operator's attention with it.
     */
    await seedFailure();
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");
    expect(result.state).toBe("backlog_draining");
    expect(await store.openIncidents(org)).toHaveLength(1);
  });

  it("does not call itself recovered until a downstream record changed", async () => {
    /*
     * A queue can drain by failing. `reconcileDraining` refuses to close the
     * incident while nothing has completed, and closes it once something has.
     */
    await seedFailure();
    const inc = await openIncident();
    await runRecoveryCheck(inc.id, org, "op@probe.invalid");
    await query(
      `update incident_requeues set outcome='succeeded', outcome_at=now() where incident_id=$1`,
      [inc.id]
    );

    const stillOpen = await reconcileDraining((await store.incidentById(inc.id, org))!);
    expect(stillOpen.state).toBe("backlog_draining");

    // Now a job actually completes.
    await seedFailure({ status: "ok", error: undefined, at: new Date() });
    const closed = await reconcileDraining((await store.incidentById(inc.id, org))!);
    expect(closed.state).toBe("recovered");
    expect(closed.recoveredAt).toBeInstanceOf(Date);
    expect(closed.recoveryNote).toContain("completed");
  });

  it("marks a requeue that the queue refused, rather than claiming it is running", async () => {
    // Automation paused between the eligibility check and the enqueue. A row
    // saying "queued" when nothing is queued would leave the incident waiting
    // for work that will never arrive.
    await seedFailure();
    QUEUE_ACCEPTS = false;
    const inc = await openIncident();
    const result = await runRecoveryCheck(inc.id, org, "op@probe.invalid");
    expect(result.requeued).toBe(0);
    const rows = await query<{ outcome: string }>(
      `select outcome from incident_requeues where incident_id = $1`,
      [inc.id]
    );
    expect(rows[0]?.outcome).toBe("failed");
  });
});
