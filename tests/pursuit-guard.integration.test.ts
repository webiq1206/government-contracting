/**
 * Nothing goes out after the operator stops a pursuit.
 *
 * The guard is checked twice on purpose, and the second check is the one that
 * earns its keep. The agent runner checks when a job starts; the send
 * transport checks again immediately before handing the message to Gmail.
 * Between those two moments a follow-up spends time resolving variables,
 * gathering attachments and rendering, which is long enough for somebody to
 * press Abort while watching an email they do not want go out.
 *
 * A single check at job start would pass every test written against a fast
 * fixture and fail exactly once in production, on the message somebody was
 * trying to stop.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("the pursuit guard", () => {
  let query: typeof import("../lib/db").query;
  let pursuitStatus: typeof import("../lib/pursuit-guard").pursuitStatus;
  let assertPursuitActive: typeof import("../lib/pursuit-guard").assertPursuitActive;

  const org = randomUUID();
  const opp = randomUUID();

  async function setState(state: string, reason: string | null = null) {
    await query(
      `update opportunities set pursuit_state = $2, pursuit_reason = $3 where id = $1`,
      [opp, state, reason]
    );
  }

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ pursuitStatus, assertPursuitActive } = await import("../lib/pursuit-guard"));
    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,'Pursuit Probe','active',true) on conflict (id) do nothing`,
      [org]
    );
    await query(
      `insert into opportunities (id, org_id, title, source, status, stage)
       values ($1,$2,'Abort probe','test','open','outreach') on conflict (id) do nothing`,
      [opp, org]
    );
  });

  afterEach(async () => {
    await setState("active", null);
  });

  afterAll(async () => {
    await query(`delete from opportunities where id = $1`, [opp]).catch(() => {});
    await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("lets an active pursuit through", async () => {
    const s = await pursuitStatus(opp);
    expect(s.mayAct).toBe(true);
    expect(s.state).toBe("active");
    await expect(assertPursuitActive(opp)).resolves.toBeUndefined();
  });

  it("defaults an existing row to active without a backfill", async () => {
    // Migration 071 sets a default rather than rewriting every row, so this is
    // also the check that the default actually applies.
    const row = await query<{ pursuit_state: string; pursuit_version: number }>(
      `select pursuit_state, pursuit_version from opportunities where id = $1`,
      [opp]
    );
    expect(row[0].pursuit_state).toBe("active");
    expect(row[0].pursuit_version).toBe(1);
  });

  it("stops a paused pursuit and says it is resumable", async () => {
    await setState("paused");
    const s = await pursuitStatus(opp);
    expect(s.mayAct).toBe(false);
    expect(s.reason).toMatch(/paused/i);
    await expect(assertPursuitActive(opp)).rejects.toThrow(/paused/i);
  });

  it("stops an aborted pursuit and carries its reason", async () => {
    await setState("aborted", "insufficient_coverage");
    const s = await pursuitStatus(opp);
    expect(s.mayAct).toBe(false);
    expect(s.reason).toContain("insufficient_coverage");
  });

  it("refuses an opportunity that no longer exists", async () => {
    // Not permission. There is nothing to act on, and a missing row must not
    // read as an absent objection.
    const s = await pursuitStatus(randomUUID());
    expect(s.mayAct).toBe(false);
    expect(s.known).toBe(false);
  });

  it("refuses when no opportunity is named", async () => {
    const s = await pursuitStatus("");
    expect(s.mayAct).toBe(false);
  });

  it("refuses rather than guesses when the state is a value it does not know", async () => {
    /*
     * The check constraint blocks this from the application, so it is written
     * directly. A value arriving from a restore, a future migration or a
     * hand-edit means this code does not understand the row, and reading that
     * as permission would resume outreach on the strength of confusion.
     */
    await query(
      `alter table opportunities drop constraint if exists opportunities_pursuit_state_check`
    );
    await setState("something_new");
    const s = await pursuitStatus(opp);
    expect(s.mayAct).toBe(false);
    await setState("active");
    await query(
      `alter table opportunities add constraint opportunities_pursuit_state_check
       check (pursuit_state in ('active','paused','aborted'))`
    );
  });

  it("blocks a send committed after the abort, not merely before it", async () => {
    /*
     * The race the instructions name. The transport re-reads the state at the
     * provider boundary, so an abort landing while a packet is being assembled
     * still stops the message.
     *
     * Modelled by reading "active" first, exactly as a job would at its start,
     * then aborting, then asking again exactly as the transport does.
     */
    const atJobStart = await pursuitStatus(opp);
    expect(atJobStart.mayAct).toBe(true);

    await setState("aborted", "strategic");

    const atSendBoundary = await pursuitStatus(opp);
    expect(atSendBoundary.mayAct).toBe(false);
    expect(atSendBoundary.reason).toMatch(/aborted/i);
  });

  it("keeps the record and its history readable after an abort", async () => {
    // Aborting stops work. It does not delete anything, and the instructions
    // are explicit that history stays available as read-only.
    await setState("aborted", "duplicate");
    const rows = await query<{ id: string; title: string | null }>(
      `select id, title from opportunities where id = $1`,
      [opp]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Abort probe");
  });
});
