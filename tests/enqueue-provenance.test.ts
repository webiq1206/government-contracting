/**
 * A queued job says which organization it belongs to, and only the queue and
 * the records get to say it.
 *
 * A job whose record is deleted has nothing left to identify its tenant, so
 * the queue stamps the enqueuing organization onto the payload and the runner
 * falls back to it when no live record answers. That stamp is only safe if it
 * cannot be forged, and the manual-run endpoint hands a request body to the
 * runner, which then decides from that payload which tenant to run as. So the
 * body is an authority document unless it is checked, and the caller writes
 * it. Two ways to abuse it, both closed here:
 *
 *   - naming another organization outright, with `orgId`
 *   - naming another organization's record, and letting the runner resolve
 *     that record's owner and run the agent as them
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const sent: { name: string; payload: Record<string, unknown> }[] = [];
let sessionUser: { id: string; organizationId: string | null } = {
  id: "u1",
  orgRole: "owner",
  organizationId: null,
};

vi.mock("../lib/queue/pgboss", () => ({
  createPgBossQueue: async () => ({
    start: async () => {},
    enqueue: async (name: string, payload: Record<string, unknown>) => {
      sent.push({ name, payload });
      return "job-1";
    },
    work: async () => {},
    stop: async () => {},
  }),
}));

vi.mock("@/lib/app-settings", () => ({
  isAutomationPaused: async () => false,
  isAutomationStopped: async () => false,
  isPlatformAutomationPaused: async () => false,
  AUTOMATION_PAUSED_ERROR: "paused",
}));
vi.mock("../lib/app-settings", () => ({
  isAutomationPaused: async () => false,
  isAutomationStopped: async () => false,
  isPlatformAutomationPaused: async () => false,
  AUTOMATION_PAUSED_ERROR: "paused",
}));
vi.mock("@/lib/api-auth", () => ({ requireUser: async () => sessionUser }));
vi.mock("@/lib/agents/registry", () => ({
  getAgent: (name: string) => ({ name, label: name, description: "", handler: async () => ({}) }),
}));

const OURS = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const KEY = "enqueuedByOrgId";

describe("who a queued job says it belongs to", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("replaces a provenance the caller tried to set", async () => {
    const { enqueue } = await import("../lib/queue");
    const { runWithOrg } = await import("../lib/tenant-context");

    await runWithOrg(OURS, () =>
      enqueue("bid-builder", { opportunityId: "x", [KEY]: THEIRS })
    );

    expect(sent[0].payload[KEY]).toBe(OURS);
  });

  it("drops it entirely when there is no organization to stamp", async () => {
    // Better absent than forged. The runner treats a missing provenance as
    // "no context", which is what a platform-wide cron sweep wants anyway.
    const { enqueue } = await import("../lib/queue");
    await enqueue("bid-builder", { opportunityId: "x", [KEY]: THEIRS });

    expect(sent[0].payload[KEY]).toBeUndefined();
  });

  it("takes it from the caller's option, which a request body cannot reach", async () => {
    // How the runner passes the org for an agent's downstream work: that loop
    // runs outside the tenant context on purpose, because enqueue() reads the
    // per-organization automation pause switch.
    const { enqueue } = await import("../lib/queue");
    await enqueue("outreach", { subcontractorId: "y" }, { orgId: OURS });

    expect(sent[0].payload[KEY]).toBe(OURS);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("what the manual run endpoint accepts (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;

  const ourName = `run-ours-${randomUUID()}`;
  const theirName = `run-theirs-${randomUUID()}`;
  let ourOrg = "";
  let theirOrg = "";
  let ourOpp = "";
  let theirOpp = "";

  const run = async (body: unknown) => {
    const { POST } = await import("../app/api/agents/[name]/run/route");
    return POST(
      new Request("http://localhost/api/agents/bid-builder/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: { name: "bid-builder" } }
    );
  };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    const mkOrg = async (name: string) =>
      (await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [name]
      ))!.id;
    const mkOpp = async (org: string, title: string) =>
      (await queryOne<{ id: string }>(
        `insert into opportunities (org_id, source, title, stage, status)
         values ($1,'test',$2,'monitoring','open') returning id`,
        [org, title]
      ))!.id;

    ourOrg = await mkOrg(ourName);
    theirOrg = await mkOrg(theirName);
    ourOpp = await mkOpp(ourOrg, `${ourName} opp`);
    theirOpp = await mkOpp(theirOrg, `${theirName} opp`);
    sessionUser = { id: "u1", organizationId: ourOrg };
  });

  afterAll(async () => {
    for (const org of [ourOrg, theirOrg]) {
      if (!org) continue;
      await query(`delete from opportunities where org_id = $1`, [org]).catch(() => {});
      await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    }
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it("runs an agent on the caller's own record", async () => {
    const res = await run({ opportunityId: ourOpp });

    expect(res.status).toBe(200);
    expect(sent.length).toBe(1);
    expect(sent[0].payload.opportunityId).toBe(ourOpp);
    // Still a manual, forced run: the guard drops nothing the operator meant.
    expect(sent[0].payload.force).toBe(true);
    expect(sent[0].payload.trigger).toBe("manual");
  });

  it("refuses another organization's record", async () => {
    /**
     * The dangerous one. The runner resolves the tenant from the records a
     * payload names, so a bare record id used to be enough to have an agent
     * read, write, bill and log as another customer.
     */
    const res = await run({ opportunityId: theirOpp });

    expect(res.status).toBe(404);
    expect(sent.length).toBe(0);
  });

  it("answers the same way for a record that does not exist", async () => {
    // Otherwise the difference between the two answers is a way to ask which
    // record ids are real.
    const foreign = await run({ opportunityId: theirOpp });
    const absent = await run({ opportunityId: randomUUID() });
    const nonsense = await run({ opportunityId: "not-a-uuid" });

    expect(absent.status).toBe(foreign.status);
    expect(nonsense.status).toBe(foreign.status);
    expect(await absent.json()).toEqual(await foreign.json());
    expect(sent.length).toBe(0);
  });

  it("cannot name another tenant outright", async () => {
    const res = await run({ orgId: theirOrg, opportunityId: ourOpp });

    expect(res.status).toBe(200);
    expect(sent[0].payload.orgId).toBeUndefined();
    expect(sent[0].payload[KEY]).not.toBe(theirOrg);
  });

  it("cannot smuggle in a provenance stamp either", async () => {
    const res = await run({ [KEY]: theirOrg, opportunityId: ourOpp });

    expect(res.status).toBe(200);
    expect(sent[0].payload[KEY]).not.toBe(theirOrg);
  });

  it("still allows a sweep that names no record at all", async () => {
    const res = await run({});

    expect(res.status).toBe(200);
    expect(sent.length).toBe(1);
  });
});
