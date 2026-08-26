/**
 * Agent run history belongs to one organization.
 *
 * `/agents` is the customer-facing Automation Health page. It reads job_runs
 * through agentStatuses() and jobRunsSummary(), and job_runs had no org_id at
 * all, so neither query could scope and neither did. Every customer was shown,
 * per agent: run counts and error counts across the whole platform, plus the
 * error text and summary JSON of whichever tenant ran that agent most
 * recently.
 *
 * The counts alone would be a leak of business volume. `last_error` and
 * `last_summary` are worse: a summary reading "Compliance monitor: 3 orgs
 * checked" is another customer's account count, and an error can name a record
 * outright.
 *
 * Run against a real database because the defect was a missing WHERE clause,
 * and a mock that returns what it was told cannot fail the way the real query
 * did.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("job_runs tenant scoping", () => {
  let query: typeof import("../lib/db").query;
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;
  let agentStatuses: typeof import("../lib/data").agentStatuses;
  let jobRunsSummary: typeof import("../lib/data").jobRunsSummary;
  let platformJobRunsSummary: typeof import("../lib/data").platformJobRunsSummary;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const AGENT = `tenant-probe-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ runWithOrg } = await import("../lib/tenant-context"));
    ({ agentStatuses, jobRunsSummary, platformJobRunsSummary } = await import("../lib/data"));

    for (const [id, name] of [[orgA, "Probe A"], [orgB, "Probe B"]] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }

    // A's run: succeeded, with a summary naming A's own work.
    await query(
      `insert into job_runs (agent, trigger, status, org_id, finished_at, summary)
       values ($1,'cron','ok',$2, now(), $3::jsonb)`,
      [AGENT, orgA, JSON.stringify({ summary: "Checked 1 opportunity for Probe A" })]
    );
    // B's run: failed, more recent, with an error naming B's record. This is
    // the row that used to appear on A's screen.
    await query(
      `insert into job_runs (agent, trigger, status, org_id, finished_at, error, summary)
       values ($1,'cron','error',$2, now(), $3, $4::jsonb)`,
      [
        AGENT,
        orgB,
        "Probe B secret: solicitation W912-B-0042 failed",
        JSON.stringify({ summary: "Probe B secret summary" }),
      ]
    );
    // A legacy row from before migration 070: no owner, unprovable.
    await query(
      `insert into job_runs (agent, trigger, status, org_id, finished_at)
       values ($1,'cron','ok',null, now())`,
      [AGENT]
    );
  });

  afterAll(async () => {
    await query(`delete from job_runs where agent = $1`, [AGENT]).catch(() => {});
    await query(`delete from organizations where id = any($1::uuid[])`, [[orgA, orgB]]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("shows an organization only its own runs", async () => {
    const rows = await runWithOrg(orgA, () => agentStatuses());
    const mine = rows.find((r) => r.agent === AGENT);
    expect(mine).toBeDefined();
    expect(mine!.runs_24h).toBe(1);
    // B's failure must not be counted against A.
    expect(mine!.errors_24h).toBe(0);
  });

  it("never puts another tenant's error text or summary on this tenant's page", async () => {
    const rows = await runWithOrg(orgA, () => agentStatuses());
    const mine = rows.find((r) => r.agent === AGENT)!;
    const blob = JSON.stringify([mine.last_error, mine.last_summary]);
    expect(blob).not.toContain("Probe B secret");
    expect(blob).not.toContain("W912-B-0042");
    // And it is positively A's own run, not merely "not B's".
    expect(blob).toContain("Probe A");
  });

  it("scopes the lateral as well as the outer query", async () => {
    /*
     * The specific way this could have been half-fixed. Filtering only the
     * outer query gives A its own counts with B's most recent run supplying
     * last_error and last_summary beside them: a leak wearing a filter, and one
     * that looks right in a screenshot.
     */
    const rows = await runWithOrg(orgB, () => agentStatuses());
    const theirs = rows.find((r) => r.agent === AGENT)!;
    expect(theirs.last_status).toBe("error");
    const forA = (await runWithOrg(orgA, () => agentStatuses())).find((r) => r.agent === AGENT)!;
    expect(forA.last_status).toBe("ok");
  });

  it("excludes legacy rows that cannot be attributed, rather than guessing", async () => {
    const a = await runWithOrg(orgA, () => agentStatuses());
    const b = await runWithOrg(orgB, () => agentStatuses());
    // Three rows exist for this agent; each tenant sees exactly one.
    expect(a.find((r) => r.agent === AGENT)!.runs_24h).toBe(1);
    expect(b.find((r) => r.agent === AGENT)!.runs_24h).toBe(1);
  });

  it("scopes the tally query the same way", async () => {
    const rows = (await runWithOrg(orgA, () => jobRunsSummary())) as Array<{
      agent: string;
      ok: string;
      error: string;
    }>;
    const mine = rows.find((r) => r.agent === AGENT)!;
    expect(Number(mine.ok)).toBe(1);
    expect(Number(mine.error)).toBe(0);
  });

  it("still lets platform admin see everything, including the unattributed rows", async () => {
    const rows = (await platformJobRunsSummary()) as Array<{
      agent: string;
      ok: string;
      error: string;
      unattributed: string;
    }>;
    const all = rows.find((r) => r.agent === AGENT)!;
    expect(Number(all.ok)).toBe(2); // A's run plus the legacy row
    expect(Number(all.error)).toBe(1); // B's
    expect(Number(all.unattributed)).toBe(1);
  });
});
