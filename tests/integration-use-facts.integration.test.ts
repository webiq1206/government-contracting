/**
 * A test and a real call are different evidence, and were one column.
 *
 * integration_settings had last_validated_at, written only by the Test button,
 * and the Integrations page told the operator it showed when each service was
 * last used successfully. So an integration doing real work every hour read as
 * last verified six weeks ago, and one tested this morning that had refused
 * every real call since read as verified today.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("integration use facts (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let store: typeof import("../lib/integration-settings");
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;

  const tag = randomUUID();
  let orgId = "";
  let otherOrgId = "";
  const KEY = "SAM_API_KEY" as const;

  const row = (org: string) =>
    queryOne<{
      last_success_at: Date | null;
      last_tested_at: Date | null;
      last_error: string | null;
      quota_note: string | null;
    }>(
      `select last_success_at, last_tested_at, last_error, quota_note
         from integration_settings where env_key = $1 and org_id = $2`,
      [KEY, org]
    );

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    store = await import("../lib/integration-settings");
    ({ runWithOrg } = await import("../lib/tenant-context"));

    const mkOrg = async (s: string) =>
      (await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`intuse-${s}-${tag}`]
      ))!.id;
    orgId = await mkOrg("a");
    otherOrgId = await mkOrg("b");

    for (const org of [orgId, otherOrgId]) {
      await runWithOrg(org, () => store.saveSetting(KEY, `key-${tag}`));
    }
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      await query(`delete from integration_settings where org_id = $1`, [org]).catch(() => {});
      await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    }
  });

  it("records a test as a test, not as real use", async () => {
    await runWithOrg(orgId, () => store.recordValidation(KEY, true));
    const r = await row(orgId);
    expect(r?.last_tested_at).not.toBeNull();
    // The whole point: pressing Test does not claim the thing did its job.
    expect(r?.last_success_at).toBeNull();
  });

  it("records a real call as real use", async () => {
    await runWithOrg(orgId, () => store.recordIntegrationUse(KEY, { ok: true }));
    const r = await row(orgId);
    expect(r?.last_success_at).not.toBeNull();
  });

  it("clears a standing error when a real call works", async () => {
    /*
     * An integration that has just done its job is not broken, whatever it
     * did last week. Leaving the old message up is how a page reports a
     * service as blocked while it is quietly working.
     */
    await runWithOrg(orgId, () => store.recordIntegrationUse(KEY, { ok: false, error: "429 rate limited" }));
    expect((await row(orgId))?.last_error).toBe("429 rate limited");
    await runWithOrg(orgId, () => store.recordIntegrationUse(KEY, { ok: true }));
    expect((await row(orgId))?.last_error).toBeNull();
  });

  it("does not advance the success time on a failed call", async () => {
    const before = (await row(orgId))?.last_success_at;
    await runWithOrg(orgId, () => store.recordIntegrationUse(KEY, { ok: false, error: "500" }));
    expect((await row(orgId))?.last_success_at).toEqual(before);
  });

  it("keeps what the provider said about quota", async () => {
    await runWithOrg(orgId, () =>
      store.recordIntegrationUse(KEY, { ok: false, error: "over quota", quotaNote: "1000 of 1000 used today" })
    );
    expect((await row(orgId))?.quota_note).toBe("1000 of 1000 used today");
  });

  it("never touches another organization's row", async () => {
    const theirs = await row(otherOrgId);
    expect(theirs?.last_success_at).toBeNull();
    expect(theirs?.last_tested_at).toBeNull();
    expect(theirs?.last_error).toBeNull();
  });

  it("never throws when the row is missing", async () => {
    // Bookkeeping about a call that already happened must not turn a
    // successful send into a failed one.
    await expect(
      runWithOrg(orgId, () => store.recordIntegrationUse("HUNTER_API_KEY", { ok: true }))
    ).resolves.toBeUndefined();
  });
});
