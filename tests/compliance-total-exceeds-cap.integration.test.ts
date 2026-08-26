/**
 * Twenty overdue registrations must read as twenty, not as eight.
 *
 * The complianceAlerts query is `limit 8` because it renders a preview strip
 * as well as feeding a number. Today passed that array's length to the work
 * ledger, so the headline number saturated at the cap: an account could clear
 * twelve compliance items and watch the number not move.
 *
 * The guard in ledger-totals-not-caps.test.ts reads the call site and catches
 * the shape returning. This one proves the arithmetic against a real database,
 * because a call site can look right while the query behind it is wrong.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("the compliance count behind the ledger", () => {
  let query: typeof import("../lib/db").query;
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;
  let actionCenter: typeof import("../lib/data").actionCenter;

  const org = randomUUID();
  const ALERTS = 20; // comfortably past the `limit 8`

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ runWithOrg } = await import("../lib/tenant-context"));
    ({ actionCenter } = await import("../lib/data"));

    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,'Compliance Cap Probe','active',true) on conflict (id) do nothing`,
      [org]
    );
    for (let i = 0; i < ALERTS; i++) {
      await query(
        `insert into compliance_items (org_id, category, label, status, due_at)
         values ($1,'registration',$2,'critical', now() + interval '3 days')`,
        [org, `Probe item ${i + 1}`]
      );
    }
  });

  afterAll(async () => {
    await query(`delete from compliance_items where org_id = $1`, [org]).catch(() => {});
    await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("reports every alert, not the preview cap", async () => {
    const data = await runWithOrg(org, () => actionCenter());
    expect(data.totals.compliance).toBe(ALERTS);
  });

  it("still caps the preview list itself, which is what it is for", async () => {
    const data = await runWithOrg(org, () => actionCenter());
    expect(data.complianceAlerts.length).toBe(8);
    // The two disagreeing is the point: one is a list to show, the other is
    // the amount of work. Making them equal would mean either a truncated
    // count or an unbounded list on the page.
    expect(data.complianceAlerts.length).toBeLessThan(data.totals.compliance);
  });
});
