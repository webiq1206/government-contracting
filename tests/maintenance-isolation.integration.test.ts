/**
 * Two-organization isolation proof for the maintenance sweeps.
 *
 * These are crons with no payload, so nothing ever set a tenant context and
 * every sweep read the whole platform while resolving each customer's settings
 * from the founding org. The consequences are not symmetrical, so each is
 * proved separately:
 *
 *   retention        deletes, permanently, on someone else's window
 *   contact recheck  a fixed batch taken across all tenants starves the rest
 *   outreach         a follow-up leaves through another org's mailbox
 *
 * Every assertion here fails on the unscoped code.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { withSweepLock } from "./helpers/sweep-lock";
import { randomUUID } from "crypto";

/** Every send the follow-up sweep attempted, with the org it charged. */
const sends: { to: string; orgId: string | undefined }[] = [];

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail: async (params: { to: string; orgId?: string }) => {
    sends.push({ to: params.to, orgId: params.orgId });
    return { provider: "gmail", messageId: `msg-${sends.length}` };
  },
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("maintenance sweeps stay inside one organization (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let maintenance: typeof import("../lib/agents/maintenance");
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;
  let setAutomationRules: typeof import("../lib/app-settings").setAutomationRules;

  const orgs = {
    a: { id: "", name: `maint-a-${randomUUID()}`, staleOpp: "", sub: "", opp: "" },
    b: { id: "", name: `maint-b-${randomUUID()}`, staleOpp: "", sub: "", opp: "" },
  };

  /**
   * Subcontractor ids are supplied rather than generated, because the recheck
   * batch is ordered by id. Org A's subs all sort before org B's, so a
   * platform-wide batch of 20 provably never reaches org B; left to random
   * uuids the same test would pass by luck most runs.
   */
  function subId(prefix: string) {
    return `${prefix}${randomUUID().slice(4)}`;
  }

  async function makeOrg(
    o: (typeof orgs)["a"],
    retentionDays: number,
    subCount: number,
    idPrefix: string
  ) {
    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [o.name]
    );
    o.id = org!.id;
    await runWithOrg(o.id, () =>
      setAutomationRules({ retention_days: retentionDays }, "test@example.com")
    );

    // A stale archived record with no bid, quote, or contract: eligible for
    // purge under a 1-day window, ineligible under "keep forever".
    const stale = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, title, stage, status, source, updated_at)
       values ($1, $2, 'dismissed', 'archived', 'manual', '2020-01-01') returning id`,
      [o.id, `${o.name} stale`]
    );
    o.staleOpp = stale!.id;

    // An open opportunity plus subs with no email, all overdue for a recheck.
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, title, stage, status, source)
       values ($1, $2, 'outreach', 'open', 'manual') returning id`,
      [o.id, `${o.name} open`]
    );
    o.opp = opp!.id;

    for (let i = 0; i < subCount; i++) {
      const sub = await queryOne<{ id: string }>(
        `insert into subcontractors (id, org_id, company_name, trade_categories, phone, contact_checked_at)
         values ($4, $1, $2, $3, '555-0100', null) returning id`,
        [o.id, `${o.name} sub ${i}`, ["electrical"], subId(idPrefix)]
      );
      if (!o.sub) o.sub = sub!.id;
      await query(
        `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
         values ($1, $2, 'electrical', 'sent')`,
        [o.opp, sub!.id]
      );
    }
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    maintenance = await import("../lib/agents/maintenance");
    ({ runWithOrg } = await import("../lib/tenant-context"));
    ({ setAutomationRules } = await import("../lib/app-settings"));

    // Org A purges after a day. Org B asked to keep its records forever, and
    // brings up the rear of the recheck queue with a single sub.
    await makeOrg(orgs.a, 1, 25, "0000");
    await makeOrg(orgs.b, 0, 1, "ffff");
  });

  afterAll(async () => {
    for (const o of [orgs.a, orgs.b]) {
      if (!o.id) continue;
      await query(`delete from communications where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from opportunity_subs where opportunity_id = $1`, [o.opp]).catch(
        () => {}
      );
      await query(`delete from agent_logs where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from subcontractors where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from app_settings where key = $1`, [
        `${o.id}:automation_rules`,
      ]).catch(() => {});
      await query(`delete from organizations where id = $1`, [o.id]).catch(() => {});
    }
  });

  it("purges on each organization's own retention window", async () => {
    await maintenance.retentionSweep.handler({
      runId: randomUUID(),
      trigger: "cron",
      payload: {},
    });

    const a = await queryOne(`select id from opportunities where id = $1`, [orgs.a.staleOpp]);
    const b = await queryOne(`select id from opportunities where id = $1`, [orgs.b.staleOpp]);
    expect(a, "org A set a 1-day window, so its stale record goes").toBeNull();
    expect(b, "org B asked to keep its records forever").not.toBeNull();
  });

  it("gives every organization a share of the contact recheck batch", async () => {
    const res = await maintenance.contactRecheckSweep.handler({
      runId: randomUUID(),
      trigger: "cron",
      payload: {},
    });
    const subIds = (res.enqueued ?? []).map((e) => e.payload.subcontractorId);
    // Org A has 25 subs due and would take a platform-wide batch of 20 whole,
    // leaving org B's single sub unverified on every run forever.
    expect(subIds).toContain(orgs.b.sub);
  });

  it("sends each follow-up from the organization that owns the conversation", async () => {
    sends.length = 0;
    /*
     * Seeded and swept under the shared lock. The sweep reads every
     * organization by design, so without it another test file's due
     * conversation is sent by this run and this file's rows by theirs.
     */
    await withSweepLock(async () => {
      for (const o of [orgs.a, orgs.b]) {
        await query(
          `insert into communications
             (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, follow_up_at)
           values ($1, $2, $3, 'email', 'outbound', 'q', 'q', now() - interval '1 hour')`,
          [o.id, o.sub, o.opp]
        );
        await query(`update subcontractors set email = $2, email_verified = true where id = $1`, [
          o.sub,
          `${o.name}@example.invalid`,
        ]);
      }

      await maintenance.outreachFollowup.handler({
        runId: randomUUID(),
        trigger: "cron",
        payload: {},
      });
    });

    /*
     * Every send, not just the two expected ones. The lock above makes the
     * sweep's whole output this test's own, so a third send is a real finding:
     * either a leak into another tenant's conversation, or a duplicate.
     */
    expect(sends.length).toBe(2);
    for (const send of sends) {
      const owner = [orgs.a, orgs.b].find((o) => send.to === `${o.name}@example.invalid`);
      expect(owner, `unexpected recipient ${send.to}`).toBeTruthy();
      // The org decides which mailbox sends, whose name is on the From line,
      // and whose quota is charged. Unscoped, both of these were the founding
      // organization.
      expect(send.orgId).toBe(owner!.id);
    }
  });
});
