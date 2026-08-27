/**
 * The counts behind the rule preview, against a real schema.
 *
 * This is the number an operator decides on. A join that silently counts the
 * wrong rows does not throw; it produces a plausible figure, and somebody
 * shortens their retention window on the strength of it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { DEFAULT_RULES, type AutomationRules } from "../lib/domain/intake";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("rule preview counts (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let preview: typeof import("../lib/rule-preview");
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;

  const tag = randomUUID();
  let orgId = "";
  let otherOrgId = "";
  let protectedId = "";

  const rules = (over: Partial<AutomationRules> = {}): AutomationRules => ({
    ...DEFAULT_RULES,
    ...over,
  });

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    preview = await import("../lib/rule-preview");
    ({ runWithOrg } = await import("../lib/tenant-context"));

    const mkOrg = async (s: string) =>
      (await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`rules-${s}-${tag}`]
      ))!.id;
    orgId = await mkOrg("a");
    otherOrgId = await mkOrg("b");

    /** Arrived `arrivedDaysAgo` ago with a deadline `leadDays` after arrival. */
    const opp = async (
      org: string,
      title: string,
      arrivedDaysAgo: number,
      leadDays: number | null,
      extra: Record<string, unknown> = {}
    ) =>
      (await queryOne<{ id: string }>(
        `insert into opportunities
           (org_id, source, title, stage, status, tier, created_at, deadline, pursuit_changed_at)
         values ($1,'test',$2,$3,$4,$5,
                 now() - ($6 || ' days')::interval,
                 case when $7::numeric is null then null
                      else now() - ($6 || ' days')::interval + ($7 || ' days')::interval end,
                 $8)
         returning id`,
        [
          org, title,
          (extra.stage as string) ?? "monitoring",
          (extra.status as string) ?? "open",
          (extra.tier as string | null) ?? null,
          String(arrivedDaysAgo),
          leadDays == null ? null : String(leadDays),
          (extra.pursuitAt as string | null) ?? null,
        ]
      ))!.id;

    // Lead times of 2, 5 and 20 days, all still open and dated.
    await opp(orgId, `lead2 ${tag}`, 1, 2);
    await opp(orgId, `lead5 ${tag}`, 1, 5);
    await opp(orgId, `lead20 ${tag}`, 1, 20);
    // Open with no deadline: outside every dated calculation.
    await opp(orgId, `undated ${tag}`, 1, null);
    // Waiting on a decision.
    await opp(orgId, `review ${tag}`, 1, 30, { tier: "review" });
    /*
     * Archived long ago, with a deadline long past, and deletable.
     *
     * Dated on purpose: the sweep ages a record from `coalesce(deadline,
     * updated_at)`, and opportunities carries a touch trigger that resets
     * updated_at on any write, so an undated fixture cannot be aged at all.
     */
    await opp(orgId, `old-archived ${tag}`, 400, -300, {
      stage: "dismissed",
      status: "archived",
    });
    // Archived just as long ago, but carrying a bid: never deletable.
    protectedId = await opp(orgId, `protected ${tag}`, 400, -300, {
      stage: "dismissed",
      status: "archived",
    });
    await query(
      `insert into bids (org_id, opportunity_id, bid_amount) values ($1,$2,1000)`,
      [orgId, protectedId]
    );

    // Another tenant, identical in shape.
    await opp(otherOrgId, `theirs ${tag}`, 1, 2);
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      await query(`delete from bids where org_id = $1`, [org]).catch(() => {});
      await query(`delete from communications where org_id = $1`, [org]).catch(() => {});
      await query(
        `delete from opportunity_subs where opportunity_id in
           (select id from opportunities where org_id = $1)`,
        [org]
      ).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [org]).catch(() => {});
      await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    }
  });

  it("measures lead time from arrival, not from today", async () => {
    /*
     * Days remaining is a different number, and using it would make the
     * preview drift every hour without any rule changing.
     */
    const f = await runWithOrg(orgId, () =>
      preview.ruleFacts(rules({ min_lead_days: 3 }), rules({ min_lead_days: 7 }))
    );
    expect(f.belowCurrentLead).toBe(1); // the 2-day one
    expect(f.belowProposedLead).toBe(2); // and the 5-day one
  });

  it("leaves undated opportunities out of every dated count", async () => {
    const f = await runWithOrg(orgId, () => preview.ruleFacts(rules(), rules()));
    // Four dated open records; the undated one is in none of them.
    expect(f.datedOpen).toBe(4);
  });

  it("never counts a record the sweep would refuse to delete", async () => {
    /*
     * The sweep never deletes an archived opportunity carrying a bid or a
     * contract. A preview that promised otherwise would overstate the loss
     * on the one setting that destroys data.
     */
    const f = await runWithOrg(orgId, () =>
      preview.ruleFacts(rules({ retention_days: 0 }), rules({ retention_days: 30 }))
    );
    expect(f.archivedBeyondProposed).toBe(1);
    expect(f.archivedBeyondCurrent).toBe(0);
  });

  it("counts what is waiting on a decision", async () => {
    const f = await runWithOrg(orgId, () => preview.ruleFacts(rules(), rules()));
    expect(f.reviewUndecided).toBe(1);
  });

  it("never counts another organization's records", async () => {
    const f = await runWithOrg(otherOrgId, () =>
      preview.ruleFacts(rules({ min_lead_days: 3 }), rules({ min_lead_days: 7 }))
    );
    expect(f.datedOpen).toBe(1);
    expect(f.reviewUndecided).toBe(0);
    expect(f.archivedBeyondProposed).toBe(0);
  });

  it("returns zeroes rather than throwing on an untouched account", async () => {
    const empty = (await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`rules-empty-${tag}`]
    ))!.id;
    try {
      const f = await runWithOrg(empty, () => preview.ruleFacts(rules(), rules()));
      expect(f.datedOpen).toBe(0);
      expect(f.callsPending).toBe(0);
    } finally {
      await query(`delete from organizations where id = $1`, [empty]).catch(() => {});
    }
  });
});
