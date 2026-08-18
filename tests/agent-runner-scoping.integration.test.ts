/**
 * The runner puts every job in its own organization's context.
 *
 * Twelve cross-tenant scans were fixed one agent at a time, and the last one
 * showed why that is not enough on its own: the scoring engine had no scan at
 * all. Its bug was that a queue job carries a payload and nothing else, so
 * every lookup that asked who the tenant was got the founding org, and each
 * customer's opportunities were scored on our rubric and billed to our key.
 * Nine other agents had the same shape.
 *
 * That is a default, not nine bugs, so it is fixed where the default lives.
 * The probe below is not a real agent: it reports the context it was handed
 * and the profile that context resolves to, which is exactly what those nine
 * agents depend on and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("agent runner tenant context (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let runAgent: typeof import("../lib/agents/runner").runAgent;
  let currentOrgId: typeof import("../lib/tenant-context").currentOrgId;
  let getProfileJson: typeof import("../lib/ai/companyProfile").getProfileJson;

  const PROBE = "runner-scope-probe";
  /** What the probe saw on each run, in order. */
  const seen: { orgId: string | null; profileName: string | null }[] = [];

  const orgA = { id: "", name: `runner-a-${randomUUID()}`, opp: "", sub: "" };
  const orgB = { id: "", name: `runner-b-${randomUUID()}`, opp: "", sub: "" };

  function probeAgent() {
    return {
      name: PROBE,
      label: "Runner scope probe",
      description: "Reports the tenant context the runner handed it.",
      worksWithoutClaude: true,
      async handler() {
        seen.push({
          orgId: currentOrgId(),
          // The nine agents reach their tenant through exactly this call.
          profileName: (await getProfileJson())?.legal_name ?? null,
        });
        return { ok: true as const, summary: "probe" };
      },
    };
  }

  async function makeOrg(o: typeof orgA) {
    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [o.name]
    );
    o.id = org!.id;
    await query(
      `insert into company_profile (org_id, version, is_active, profile_json, profile_text)
       values ($1, 1, true, $2::jsonb, $3)`,
      [o.id, JSON.stringify({ legal_name: o.name }), `Profile for ${o.name}`]
    );
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status)
       values ($1, 'test', $2, 'monitoring', 'open') returning id`,
      [o.id, `${o.name} opportunity`]
    );
    o.opp = opp!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, phone)
       values ($1, $2, '555-0100') returning id`,
      [o.id, `${o.name} sub`]
    );
    o.sub = sub!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ runAgent } = await import("../lib/agents/runner"));
    ({ currentOrgId } = await import("../lib/tenant-context"));
    ({ getProfileJson } = await import("../lib/ai/companyProfile"));
    await makeOrg(orgA);
    await makeOrg(orgB);
  });

  afterAll(async () => {
    await query(`delete from job_runs where agent = $1`, [PROBE]).catch(() => {});
    for (const o of [orgA, orgB]) {
      if (!o.id) continue;
      await query(`delete from agent_logs where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from subcontractors where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from company_profile where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from organizations where id = $1`, [o.id]).catch(() => {});
    }
    await query(`delete from agent_logs where agent = $1`, [PROBE]).catch(() => {});
  });

  it("runs a job as the organization that owns the record it names", async () => {
    seen.length = 0;
    await runAgent(probeAgent(), "queue", { opportunityId: orgA.opp });
    await runAgent(probeAgent(), "queue", { opportunityId: orgB.opp });

    expect(seen.length).toBe(2);
    expect(seen[0].orgId).toBe(orgA.id);
    expect(seen[1].orgId).toBe(orgB.id);
    // Back to back, so a context left behind by the first job would show here.
    expect(seen[0].profileName).toBe(orgA.name);
    expect(seen[1].profileName).toBe(orgB.name);
  });

  it("resolves the organization from a subcontractor payload too", async () => {
    seen.length = 0;
    await runAgent(probeAgent(), "queue", { subcontractorId: orgB.sub });
    expect(seen[0].orgId).toBe(orgB.id);
    expect(seen[0].profileName).toBe(orgB.name);
  });

  it("prefers an organization named outright in the payload", async () => {
    seen.length = 0;
    await runAgent(probeAgent(), "queue", { orgId: orgA.id });
    expect(seen[0].orgId).toBe(orgA.id);
  });

  it("sets no context when the payload names no record", async () => {
    // Cron sweeps run per organization themselves. A default here would
    // overrule that loop, and a manual run would lose the signed-in user's org.
    seen.length = 0;
    await runAgent(probeAgent(), "cron", {});
    expect(seen[0].orgId).toBeNull();
  });

  it("does not guess an organization for an unknown or malformed id", async () => {
    // These used to run with no context, on the grounds that guessing a tenant
    // is worse than having none. They now stop before the handler instead:
    // an id with no record behind it is work that cannot be done, so it is
    // abandoned rather than retried. See the abandoned-record tests.
    seen.length = 0;
    const malformed = await runAgent(probeAgent(), "queue", { opportunityId: "not-a-uuid" });
    const unknown = await runAgent(probeAgent(), "queue", { opportunityId: randomUUID() });

    expect(seen.length).toBe(0);
    expect(malformed.permanent).toBe(true);
    expect(unknown.permanent).toBe(true);
  });

  it("reports a payload that names two organizations", async () => {
    seen.length = 0;
    await runAgent(probeAgent(), "queue", {
      opportunityId: orgA.opp,
      subcontractorId: orgB.sub,
    });
    // It still runs, under the opportunity's org, because refusing would strand
    // the job in the queue's retry loop. But it says so.
    expect(seen[0].orgId).toBe(orgA.id);
    const mismatch = await query<{ message: string | null }>(
      `select message from agent_logs
        where agent = $1 and action = 'payload-org-mismatch'`,
      [PROBE]
    );
    expect(mismatch.length).toBe(1);
    expect(mismatch[0].message).toContain(orgB.id);
  });

  it("files the runner's own log lines under the job's organization", async () => {
    // These are the "run" entries the runner writes around every job. Before,
    // a queue job's lines carried no org and the Automation Log never showed
    // them to the customer whose job it was.
    const logs = await query<{ org_id: string | null }>(
      `select org_id from agent_logs where agent = $1 and action = 'run' and org_id = $2`,
      [PROBE, orgA.id]
    );
    expect(logs.length).toBeGreaterThan(0);
  });
});
