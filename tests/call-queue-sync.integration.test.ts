/**
 * The sidebar badge and the Call Queue page must be counting the same thing.
 *
 * They were not. Four copies of "which calls are still waiting" had drifted:
 * the badge's copy was missing the snooze clause the other three had, so it
 * advertised more calls than the page would list, and no copy excluded cards
 * belonging to an opportunity that had closed. Nothing clears pending cards
 * when an opportunity is archived, won or lost, so the queue kept asking for
 * calls about finished work and the badge counted them forever.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("call queue badge and page agree (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;
  let data: typeof import("../lib/data");

  const org = { id: "", name: `callsync-${randomUUID()}` };
  const made = { workable: 0 };

  /** One opportunity with one callable sub and a pending card. */
  async function card(opts: {
    status: string;
    stage: string;
    snoozed?: boolean;
    phone?: string | null;
  }) {
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1, 'test', $2, $3, $4, now() + interval '10 days') returning id`,
      [org.id, `call ${opts.stage}/${opts.status}`, opts.stage, opts.status]
    );
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, phone)
       values ($1, $2, $3) returning id`,
      [org.id, `sub-${randomUUID().slice(0, 8)}`, opts.phone === undefined ? "555-0100" : opts.phone]
    );
    await query(
      `insert into call_cards (org_id, opportunity_id, subcontractor_id, card_json, status, snoozed_until)
       values ($1,$2,$3,'{}'::jsonb,'pending',$4)`,
      [org.id, opp!.id, sub!.id, opts.snoozed ? new Date(Date.now() + 86_400_000) : null]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ runWithOrg } = await import("../lib/tenant-context"));
    data = await import("../lib/data");

    const row = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [org.name]
    );
    org.id = row!.id;

    // Three real calls waiting.
    await card({ status: "open", stage: "call_queue" });
    await card({ status: "open", stage: "call_queue" });
    // Still open, further along: chasing a second quote is legitimate work.
    await card({ status: "open", stage: "quote_entry" });
    made.workable = 3;

    // None of these is a call anybody should be asked to make.
    await card({ status: "open", stage: "call_queue", snoozed: true });
    await card({ status: "archived", stage: "dismissed" });
    await card({ status: "archived", stage: "lost" });
    await card({ status: "open", stage: "call_queue", phone: null });
  });

  afterAll(async () => {
    if (!org.id) return;
    const { purgeOrganization } = await import("../lib/admin/accounts");
    await purgeOrganization(org.id).catch(() => {});
  });

  it("counts exactly the calls the page lists", async () => {
    const [counts, rows] = await runWithOrg(org.id, async () => [
      await data.queueCounts(),
      await data.callQueue(),
    ]);
    expect(counts.callQueue).toBe(rows.length);
    expect(counts.callQueue).toBe(made.workable);
  });

  it("agrees with what Today says is waiting", async () => {
    // Today counts the same calls from its own query. Three numbers on three
    // screens, one predicate.
    const [counts, action] = await runWithOrg(org.id, async () => [
      await data.queueCounts(),
      await data.actionCenter(),
    ]);
    expect(action.calls.count).toBe(counts.callQueue);
  });

  it("leaves out snoozed calls, closed opportunities, and subs with no phone", async () => {
    const rows = await runWithOrg(org.id, () => data.callQueue());
    const titles = rows.map((r) => r.opportunity_title);
    expect(rows).toHaveLength(3);
    expect(titles.some((t) => t?.includes("dismissed"))).toBe(false);
    expect(titles.some((t) => t?.includes("lost"))).toBe(false);
    // The card on a still-open later stage stays: the work is not finished.
    expect(titles.some((t) => t?.includes("quote_entry"))).toBe(true);
  });
});
