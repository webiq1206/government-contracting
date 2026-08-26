/**
 * Pausing automation must stop YOUR automation, and only yours.
 *
 * `isAutomationPaused()` reads a per-organization setting: app_settings keys
 * are scoped as "<orgId>:automation", and the founding organization keeps the
 * bare "automation" key it already had. The signed-in API route resolves the
 * tenant from the user, so the toggle on the Automation Health page writes the
 * right row.
 *
 * The worker does not. In `runAgent` the pause check runs BEFORE the payload's
 * organization is resolved, so at that moment there is no async-local context
 * and no signed-in user. `tryResolveTenantOrgId()` therefore falls back to
 * LEGACY_ORG_ID, `scopedKey` maps that to the bare key, and the check reads the
 * FOUNDING organization's switch for every job, whoever it belongs to.
 *
 * Two consequences, both wrong and in opposite directions:
 *
 *   1. A customer pauses their automation and their queued jobs keep running.
 *      Their own switch is never consulted.
 *   2. The founding organization pauses and every customer's jobs stop.
 *
 * The instructions ask for "Tenant A paused while tenant B continues all
 * scheduled jobs". Neither half held.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("per-organization automation pause", () => {
  let query: typeof import("../lib/db").query;
  let runAgent: typeof import("../lib/agents/runner").runAgent;
  let clearAutomationStateCache: typeof import("../lib/app-settings").clearAutomationStateCache;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const oppA = randomUUID();
  const oppB = randomUUID();
  const LEGACY = "00000000-0000-4000-8000-000000000001";

  /** Ran, as opposed to skipped. The agent sets this when its body executes. */
  let ran = false;
  const probe = {
    name: "pause-probe",
    label: "Pause Probe",
    description: "Records whether it was allowed to run.",
    worksWithoutClaude: true,
    async handler() {
      ran = true;
      return { ok: true, summary: "probe ran" };
    },
  } as unknown as import("../lib/agents/types").AgentDefinition;

  async function setPaused(key: string, paused: boolean) {
    await query(
      `insert into app_settings (key, value_json, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set value_json = excluded.value_json, updated_at = now()`,
      [key, JSON.stringify({ paused, changed_at: new Date().toISOString(), changed_by: "test" })]
    );
    clearAutomationStateCache();
  }

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ runAgent } = await import("../lib/agents/runner"));
    ({ clearAutomationStateCache } = await import("../lib/app-settings"));

    for (const [id, name] of [[orgA, "Pause A"], [orgB, "Pause B"]] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }
    for (const [id, org, title] of [
      [oppA, orgA, "Pause A opportunity"],
      [oppB, orgB, "Pause B opportunity"],
    ] as const) {
      await query(
        `insert into opportunities (id, org_id, title, source, status, stage)
         values ($1,$2,$3,'test','open','monitoring') on conflict (id) do nothing`,
        [id, org, title]
      );
    }
  });

  afterEach(async () => {
    ran = false;
    for (const k of [`${orgA}:automation`, `${orgB}:automation`, "automation", "platform_automation"]) {
      await query(`delete from app_settings where key = $1`, [k]).catch(() => {});
    }
    clearAutomationStateCache();
  });

  afterAll(async () => {
    await query(`delete from job_runs where agent = 'pause-probe'`).catch(() => {});
    await query(`delete from agent_logs where agent = 'pause-probe'`).catch(() => {});
    await query(`delete from opportunities where id = any($1::uuid[])`, [[oppA, oppB]]).catch(() => {});
    await query(`delete from organizations where id = any($1::uuid[])`, [[orgA, orgB]]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("runs a job when nothing is paused", async () => {
    const res = await runAgent(probe, "queue", { opportunityId: oppA });
    expect(ran).toBe(true);
    expect(res.ok).toBe(true);
  });

  it("stops a customer's own job when that customer pauses", async () => {
    // The half that silently did nothing: B pauses, B's queued work carries on.
    await setPaused(`${orgB}:automation`, true);
    const res = await runAgent(probe, "queue", { opportunityId: oppB });
    expect(ran).toBe(false);
    expect(res.summary).toMatch(/paused/i);
  });

  it("lets tenant B keep running while tenant A is paused", async () => {
    await setPaused(`${orgA}:automation`, true);
    await runAgent(probe, "queue", { opportunityId: oppB });
    expect(ran).toBe(true);
  });

  it("does not let the founding organization's switch stop a customer", async () => {
    /*
     * The other half, and the more damaging one. The bare "automation" key is
     * the founding organization's own row. Read without context it looked like
     * a platform switch, so the founding org pausing its own automation
     * stopped every customer on the platform.
     */
    await setPaused("automation", true);
    await runAgent(probe, "queue", { opportunityId: oppB });
    expect(ran).toBe(true);
  });

  it("still honours the founding organization's switch for its own work", async () => {
    await setPaused("automation", true);
    // Hand oppA to the founding organization for the length of this case, so
    // the job really is the founding org's own work rather than a stand-in.
    await query(`update opportunities set org_id = $1 where id = $2`, [LEGACY, oppA]);
    await runAgent(probe, "queue", { opportunityId: oppA });
    expect(ran).toBe(false);
    await query(`update opportunities set org_id = $1 where id = $2`, [orgA, oppA]);
  });

  it("keeps a real platform kill switch that stops everyone", async () => {
    await setPaused("platform_automation", true);
    await runAgent(probe, "queue", { opportunityId: oppB });
    expect(ran).toBe(false);
  });
});
