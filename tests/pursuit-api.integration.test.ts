/**
 * Pause, resume, abort and restart are four actions, not four words for one.
 *
 * The instructions are explicit that Skip, Pass, No response, Not interested,
 * Lost, Agency canceled and Aborted describe different facts and must stay
 * distinct in state, analytics and history. The same applies here: pausing
 * preserves everything and picks up where it stopped; aborting is a decision
 * that the bid is not happening, and coming back from it is a restart, because
 * the solicitation may have been amended twice in between.
 *
 * The transition this exists to refuse is resume-after-abort. Allowing it
 * would revive packets and scoring built against a solicitation that has had
 * weeks to move on, which is the one-click resume the instructions rule out.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../lib/auth";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

let CURRENT: SessionUser | null = null;
vi.mock("../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../lib/auth")>()),
  currentUser: async () => CURRENT,
}));
vi.mock("../lib/queue", () => ({
  enqueue: vi.fn(async () => "job"),
  QUEUE_NAMES: [],
}));

d("the pursuit lifecycle API", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/opportunities/[id]/pursuit/route").POST;

  const org = randomUUID();
  const opp = randomUUID();

  const req = (body: unknown) =>
    new Request("http://x", { method: "POST", body: JSON.stringify(body) });
  const call = (body: unknown) => POST(req(body), { params: { id: opp } });

  async function stateOf() {
    return queryOne<{ pursuit_state: string; pursuit_version: number; pursuit_reason: string | null }>(
      `select pursuit_state, pursuit_version, pursuit_reason from opportunities where id = $1`,
      [opp]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ POST } = await import("../app/api/opportunities/[id]/pursuit/route"));
    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,'Pursuit API Probe','active',true) on conflict (id) do nothing`,
      [org]
    );
    await query(
      `insert into opportunities (id, org_id, title, source, status, stage)
       values ($1,$2,'Lifecycle probe','test','open','outreach') on conflict (id) do nothing`,
      [opp, org]
    );
    CURRENT = {
      id: randomUUID(), email: "op@probe.invalid", name: "Op", role: "member",
      orgRole: "owner", organizationId: org, subscriptionStatus: "active",
      planKey: "pro", trialEndsAt: null,
    } as SessionUser;
  });

  afterEach(async () => {
    await query(
      `update opportunities set pursuit_state='active', pursuit_version=1, pursuit_reason=null where id=$1`,
      [opp]
    );
  });

  afterAll(async () => {
    await query(`delete from agent_logs where opportunity_id = $1`, [opp]).catch(() => {});
    await query(`delete from opportunities where id = $1`, [opp]).catch(() => {});
    await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("pauses and resumes without bumping the version", async () => {
    // A pause changes nothing about the work, so nothing downstream should
    // treat pre-pause jobs as stale.
    expect((await call({ action: "pause" })).status).toBe(200);
    expect((await stateOf())?.pursuit_state).toBe("paused");
    expect((await stateOf())?.pursuit_version).toBe(1);

    expect((await call({ action: "resume" })).status).toBe(200);
    expect((await stateOf())?.pursuit_state).toBe("active");
  });

  it("refuses to abort without a reason", async () => {
    const res = await call({ action: "abort" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Choose a reason/);
    expect((await stateOf())?.pursuit_state).toBe("active");
  });

  it("refuses Other without a note", async () => {
    const res = await call({ action: "abort", reason: "other" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Describe the reason/);
  });

  it("aborts with a structured reason and bumps the version", async () => {
    const res = await call({ action: "abort", reason: "insufficient_coverage" });
    expect(res.status).toBe(200);
    const s = await stateOf();
    expect(s?.pursuit_state).toBe("aborted");
    expect(s?.pursuit_reason).toBe("insufficient_coverage");
    // The bump is what stops a later restart reviving pre-abort work.
    expect(s?.pursuit_version).toBe(2);
  });

  it("is idempotent, so a repeated abort does not bump again", async () => {
    await call({ action: "abort", reason: "duplicate" });
    const first = (await stateOf())?.pursuit_version;
    const res = await call({ action: "abort", reason: "duplicate" });
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyAborted).toBe(true);
    expect((await stateOf())?.pursuit_version).toBe(first);
  });

  it("refuses to RESUME an aborted pursuit, and says why", async () => {
    /*
     * The transition the whole thing exists to refuse. Resuming reuses
     * everything as it stands, and that is exactly what an abort must not
     * allow: the packets and scoring it would revive were built against a
     * solicitation with weeks to move on since.
     */
    await call({ action: "abort", reason: "strategic" });
    const res = await call({ action: "resume" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/restarted, not resumed/i);
    expect(Array.isArray(body.restartChecks)).toBe(true);
    expect((await stateOf())?.pursuit_state).toBe("aborted");
  });

  it("refuses to pause an aborted pursuit", async () => {
    await call({ action: "abort", reason: "agency_cancelled" });
    expect((await call({ action: "pause" })).status).toBe(409);
    expect((await stateOf())?.pursuit_state).toBe("aborted");
  });

  it("restarts an aborted pursuit, names the revalidation, and promises no send", async () => {
    await call({ action: "abort", reason: "pricing_unacceptable" });
    const res = await call({ action: "restart" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("active");
    expect(body.revalidation.join(" ")).toMatch(/amendment/i);
    expect(body.note).toMatch(/until the rebuilt packets are approved/i);
    // Bumped again, so anything queued before the abort is distinguishable
    // from work created after the restart.
    expect((await stateOf())?.pursuit_version).toBe(3);
  });

  it("rejects an unknown action rather than doing nothing quietly", async () => {
    const res = await call({ action: "stop" });
    expect(res.status).toBe(400);
    expect((await stateOf())?.pursuit_state).toBe("active");
  });

  it("records every transition in the log, so history survives", async () => {
    await call({ action: "abort", reason: "deadline_unreachable", note: "Ran out of runway." });
    const logs = await query<{ action: string; message: string }>(
      `select action, message from agent_logs where opportunity_id = $1 order by created_at desc limit 5`,
      [opp]
    );
    expect(logs.some((l) => l.action === "pursuit-aborted")).toBe(true);
    const msg = logs.find((l) => l.action === "pursuit-aborted")!.message;
    expect(msg).toContain("op@probe.invalid");
    expect(msg).toMatch(/cannot be recalled/i);
  });
});
