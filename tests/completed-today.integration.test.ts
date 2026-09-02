/**
 * The Completed today list, against the real query and a real database.
 *
 * Worth an integration test rather than a unit one for two reasons.
 *
 * The list is a five-way union across call_cards, quotes, bids, opportunities
 * and compliance_items, and a column name that does not exist is a page that
 * throws rather than a test that fails. Five column names were guessed wrong
 * earlier in this work and every one of them was caught here rather than by
 * reading.
 *
 * And it must not cross tenants. Completions are the record of what a company
 * did today, which is exactly the kind of thing that must never appear in
 * somebody else's afternoon.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import type { SessionUser } from "../lib/auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

let CURRENT: SessionUser | null = null;
vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: vi.fn(async () => CURRENT) };
});
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

d("completed today (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let completedTodayItems: typeof import("../lib/data").completedTodayItems;
  const mine = { id: "" };
  const theirs = { id: "" };
  const opp = { id: "" };
  const otherOpp = { id: "" };

  function asOrg(id: string) {
    CURRENT = {
      id: randomUUID(), email: "op@x.invalid", name: "Op", role: "member",
      orgRole: "owner",
      organizationId: id, subscriptionStatus: "active", planKey: "pro", trialEndsAt: null,
    } as SessionUser;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ completedTodayItems } = await import("../lib/data"));

    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`done-${randomUUID()}`]
      );
      org.id = o!.id;
    }

    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1,'test','Fort Bliss HVAC','bid_building','open', now() + interval '30 days')
       returning id`,
      [mine.id]
    );
    opp.id = op!.id;
    const other = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1,'test','Somebody else job','bid_building','open', now() + interval '30 days')
       returning id`,
      [theirs.id]
    );
    otherOpp.id = other!.id;

    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
       values ($1,'Rivera Mechanical',$2,'TX','r@x.invalid',true) returning id`,
      [mine.id, ["hvac"]]
    );
    await query(
      `insert into call_cards (org_id, opportunity_id, subcontractor_id, card_json, status, called_at)
       values ($1,$2,$3,'{}'::jsonb,'completed', now())`,
      [mine.id, opp.id, s!.id]
    );
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'hvac',50000)`,
      [mine.id, opp.id, s!.id]
    );
    await query(
      `insert into communications (
         org_id, opportunity_id, subcontractor_id, channel, direction, subject, body, delivery_state
       ) values ($1,$2,$3,'email','outbound','Quote request','Please price this.','sent')`,
      [mine.id, opp.id, s!.id]
    );
    await query(
      /*
       * The evidence columns are not optional here. A submitted bid without a
       * method, a destination and a timezone is refused by the database, which
       * is the WP10 rule: the record of a submission has to be able to prove
       * one happened.
       */
      `insert into bids (org_id, opportunity_id, package_ready, submitted_at,
                         submission_method, submission_destination, sent_timezone)
       values ($1,$2,true, now(), 'email', 'ktr@army.mil', 'America/Chicago')`,
      [mine.id, opp.id]
    );

    // Somebody else's finished work, on the same day.
    const theirSub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
       values ($1,'Their Sub',$2,'CA','t@x.invalid',true) returning id`,
      [theirs.id, ["hvac"]]
    );
    await query(
      `insert into call_cards (org_id, opportunity_id, subcontractor_id, card_json, status, called_at)
       values ($1,$2,$3,'{}'::jsonb,'completed', now())`,
      [theirs.id, otherOpp.id, theirSub!.id]
    );
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from communications where org_id=$1`, [org.id]);
      await query(`delete from call_cards where org_id=$1`, [org.id]);
      await query(`delete from quotes where org_id=$1`, [org.id]);
      await query(`delete from bids where org_id=$1`, [org.id]);
      await query(`delete from subcontractors where org_id=$1`, [org.id]);
      await query(`delete from opportunities where org_id=$1`, [org.id]);
      await query(`delete from organizations where id=$1`, [org.id]);
    }
    vi.restoreAllMocks();
  });

  it("returns the day's finished work as records, newest first", async () => {
    asOrg(mine.id);
    const items = await completedTodayItems();
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("call");
    expect(kinds).toContain("enter_quote");
    expect(kinds).toContain("review_bid");
    expect(kinds).toContain("found");
    expect(kinds).toContain("email");
    const times = items.map((i) => new Date(i.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("names the subcontractor and the record, not an id", async () => {
    asOrg(mine.id);
    const call = (await completedTodayItems()).find((i) => i.kind === "call");
    expect(call?.title).toContain("Rivera Mechanical");
    expect(call?.context).toBe("Fort Bliss HVAC");
    expect(call?.href).toContain(opp.id);
  });

  it("never shows another organization's afternoon", async () => {
    asOrg(mine.id);
    const mineItems = await completedTodayItems();
    expect(JSON.stringify(mineItems)).not.toContain("Their Sub");
    expect(JSON.stringify(mineItems)).not.toContain(otherOpp.id);
    expect(mineItems.some((i) => i.kind === "email")).toBe(true);

    asOrg(theirs.id);
    const theirItems = await completedTodayItems();
    expect(JSON.stringify(theirItems)).not.toContain("Rivera Mechanical");
    expect(theirItems.every((i) => !i.href.includes(opp.id))).toBe(true);
  });
});
