/**
 * The trial meters, actually counted, and what happens when they cannot be.
 *
 * `countMetric` ended in `.catch(() => [])` and returned 0. Three SQL strings
 * sat in a lookup map that no test ever executed -- the same shape as the sort
 * whitelists, with a worse failure. A renamed column would not have shown an
 * error anywhere: the count would read 0, the banner would read "0/10", the
 * quota would never reach its limit, and the trial would silently stop being
 * metered on a billing control. The only visible symptom would have been
 * revenue.
 *
 * So this test does two things the old one could not.
 *
 * It runs each metric's SQL against a real schema, which is the half that
 * would have caught a broken query on the day it was written.
 *
 * And it breaks the query on purpose and asserts that the result is reported
 * rather than rounded down to zero: `used` is null, `unreadable` carries a
 * reference, and `exhausted` is false. That last one is the deliberate
 * fail-open -- an unreadable meter must not lock somebody out -- and it is
 * asserted here so that it stays a decision rather than becoming an accident
 * again.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

d("trial meters (integration)", () => {
  const org = { id: "" };
  let quotaState: typeof import("../lib/billing/trial-limits").quotaState;
  let allQuotaStates: typeof import("../lib/billing/trial-limits").allQuotaStates;
  let TRIAL_LIMITS: typeof import("../lib/billing/trial-limits").TRIAL_LIMITS;

  beforeAll(async () => {
    const { queryOne } = await import("../lib/db");
    ({ quotaState, allQuotaStates, TRIAL_LIMITS } = await import("../lib/billing/trial-limits"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'trialing') returning id`,
      [`quota-${randomUUID()}`]
    );
    org.id = o!.id;
  });

  it("counts every metric against the real schema", async () => {
    const metrics = Object.keys(TRIAL_LIMITS) as (keyof typeof TRIAL_LIMITS)[];
    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      const state = await quotaState(org.id, metric);
      // A metric whose SQL cannot run comes back unreadable, so asserting the
      // absence of that is asserting the query ran.
      expect(state.unreadable, `${metric} did not count`).toBeUndefined();
      expect(state.used, `${metric} used`).toBe(0);
      expect(state.limit).toBe(TRIAL_LIMITS[metric]);
      expect(state.exhausted).toBe(false);
    }
  });

  it("counts rows that exist, not a stored counter", async () => {
    const { query } = await import("../lib/db");
    const before = await quotaState(org.id, "outreach_emails");
    expect(before.used).toBe(0);

    const sub = await query<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, email, email_verified)
       values ($1,'Meter Test',$2,'m@x.invalid',true) returning id`,
      [org.id, ["hvac"]]
    );
    await query(
      `insert into communications (org_id, subcontractor_id, channel, direction, subject, body, delivery_state)
       values ($1,$2,'email','outbound','Quote request','Please price this.','sent')`,
      [org.id, sub[0].id]
    );

    const after = await quotaState(org.id, "outreach_emails");
    expect(after.used).toBe(1);
  });

  it("reports an uncountable meter instead of reading it as zero", async () => {
    const db = await import("../lib/db");
    const spy = vi
      .spyOn(db, "query")
      .mockRejectedValueOnce(new Error('column "solicitation_analysis" does not exist'));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await quotaState(org.id, "ai_briefs");

    expect(state.used, "a failed count must not read as a number").toBeNull();
    expect(state.remaining).toBeNull();
    expect(state.unreadable, "the fault must be carried, not dropped").toBeTruthy();
    expect(state.unreadable!.reference).toMatch(/^QUOTA-AI-BRIEFS-[0-9a-f]{8}$/);
    expect(state.unreadable!.detail.length).toBeGreaterThan(20);
    // Deliberate: an unreadable meter allows work and is reported, rather than
    // locking somebody out for a fault that is not theirs.
    expect(state.exhausted).toBe(false);
    // The server log carries the same reference the customer is shown.
    expect(
      errors.mock.calls.some((c) => String(c[0]).includes(state.unreadable!.reference)),
      "the reference a customer quotes must appear in the server log"
    ).toBe(true);
    // The raw database message must not be handed to the customer.
    expect(state.unreadable!.detail).not.toContain("solicitation_analysis");

    spy.mockRestore();
    errors.mockRestore();
  });

  it("gives the same reference for the same fault, and different for different", async () => {
    const db = await import("../lib/db");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const refFor = async (metric: "ai_briefs" | "bid_packages", message: string) => {
      const spy = vi.spyOn(db, "query").mockRejectedValueOnce(new Error(message));
      const s = await quotaState(org.id, metric);
      spy.mockRestore();
      return s.unreadable!.reference;
    };
    const a = await refFor("ai_briefs", "connection terminated");
    const b = await refFor("ai_briefs", "connection terminated");
    const c = await refFor("ai_briefs", "a different fault");
    const e = await refFor("bid_packages", "connection terminated");
    expect(a, "same fault must be quotable across screens").toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(e);
    errors.mockRestore();
  });

  it("still reports the other meters when one is unreadable", async () => {
    const db = await import("../lib/db");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(db, "query").mockRejectedValueOnce(new Error("boom"));

    const states = await allQuotaStates(org.id);
    expect(states.length).toBe(Object.keys(TRIAL_LIMITS).length);
    expect(states.filter((s) => s.unreadable).length).toBe(1);
    expect(states.filter((s) => s.used != null).length).toBe(states.length - 1);

    spy.mockRestore();
    errors.mockRestore();
  });
});
