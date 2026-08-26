/**
 * The stop, at the two places that reach a subcontractor.
 *
 * A rule that only exists in a domain module has stopped nothing. The failure
 * this work exists to fix is a firm that asked not to be contacted still
 * getting contacted, over the operator's name, and that failure lives in the
 * send boundary and in the run that rebuilds the call card, not in the
 * matcher.
 *
 * So both are exercised against a real database.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

d("a stop, where it has to hold", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let suppress: typeof import("../lib/suppressions").suppress;
  let lift: typeof import("../lib/suppressions").lift;
  let suppressionBlocking: typeof import("../lib/suppressions").suppressionBlocking;
  let stopImpact: typeof import("../lib/suppressions").stopImpact;
  let sendOutreachEmail: typeof import("../lib/integrations/email-transport").sendOutreachEmail;

  const org = randomUUID();
  const otherOrg = randomUUID();
  let oppId = "";
  let otherOppId = "";
  let subId = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ suppress, lift, suppressionBlocking, stopImpact } = await import("../lib/suppressions"));
    ({ sendOutreachEmail } = await import("../lib/integrations/email-transport"));

    for (const [id, name] of [
      [org, "Suppression Probe"],
      [otherOrg, "Suppression Neighbour"],
    ] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, pursuit_state)
       values ($1,'test','Stop probe','outreach','open','active') returning id`,
      [org]
    );
    oppId = opp!.id;
    const other = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, pursuit_state)
       values ($1,'test','Second bid','outreach','open','active') returning id`,
      [org]
    );
    otherOppId = other!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, email, email_verified)
       values ($1,'Quiet Sparks',$2,$3,true) returning id`,
      [org, ["Electrical"], `quiet-${randomUUID().slice(0, 8)}@example-sub.test`]
    );
    subId = sub!.id;
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'Electrical','sent')`,
      [oppId, subId]
    );
  });

  afterAll(async () => {
    for (const id of [org, otherOrg]) {
      await query(`delete from organizations where id = $1`, [id]).catch(() => {});
    }
    vi.restoreAllMocks();
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("refuses to send once outreach is stopped for this firm", async () => {
    const sub = await queryOne<{ email: string }>(
      `select email from subcontractors where id = $1`,
      [subId]
    );
    await suppress({
      orgId: org,
      subcontractorId: subId,
      opportunityId: null,
      trade: null,
      channel: "all",
      reason: "handled_elsewhere",
      actor: "op@x.invalid",
    });

    const res = await sendOutreachEmail({
      to: sub!.email,
      subject: "Pricing request",
      html: "<p>Please quote the electrical scope on the Main Street job by Friday.</p>",
      text: "Please quote the electrical scope on the Main Street job by Friday.",
      orgId: org,
      opportunityId: oppId,
      subcontractorId: subId,
      trade: "Electrical",
    });

    expect(res.blocked).toBe(true);
    expect(res.error).toContain("stopped");
    // And it says which decision stopped it. "Nothing was sent" with no reason
    // is the shape of message that makes people distrust the product and go
    // and send the email by hand.
    expect(res.error).toContain("every bid");
  });

  it("reaches a second bid, because the stop named no opportunity", async () => {
    const blocked = await suppressionBlocking(
      {
        subcontractorId: subId,
        opportunityId: otherOppId,
        trade: "Roofing",
        channel: "email",
      },
      org
    );
    expect(blocked).toBeTruthy();
  });

  it("does not reach another account", async () => {
    const blocked = await suppressionBlocking(
      {
        subcontractorId: subId,
        opportunityId: oppId,
        trade: "Electrical",
        channel: "email",
      },
      otherOrg
    );
    expect(blocked).toBeNull();
  });

  it("does not stack a second identical record when the button is pressed twice", async () => {
    const again = await suppress({
      orgId: org,
      subcontractorId: subId,
      opportunityId: null,
      trade: null,
      channel: "all",
      reason: "handled_elsewhere",
      actor: "op@x.invalid",
    });
    const rows = await query<{ id: string }>(
      `select id from outreach_suppressions
        where org_id = $1 and subcontractor_id = $2 and lifted_at is null`,
      [org, subId]
    );
    expect(rows).toHaveLength(1);
    expect(again.id).toBe(rows[0]!.id);
  });

  it("sends again once the stop is lifted, and keeps who lifted it", async () => {
    const rows = await query<{ id: string }>(
      `select id from outreach_suppressions where org_id = $1 and subcontractor_id = $2`,
      [org, subId]
    );
    expect(await lift(rows[0]!.id, org, "owner@x.invalid")).toBe(true);
    expect(
      await suppressionBlocking(
        { subcontractorId: subId, opportunityId: oppId, trade: "Electrical", channel: "email" },
        org
      )
    ).toBeNull();
    // Marked, not deleted: "who decided to start calling them again" has to
    // have an answer.
    const lifted = await queryOne<{ lifted_by: string | null }>(
      `select lifted_by from outreach_suppressions where id = $1`,
      [rows[0]!.id]
    );
    expect(lifted?.lifted_by).toBe("owner@x.invalid");
    // And lifting it a second time is not a second lift.
    expect(await lift(rows[0]!.id, org, "owner@x.invalid")).toBe(false);
  });

  it("will not let one account lift another's stop", async () => {
    const s = await suppress({
      orgId: org,
      subcontractorId: subId,
      opportunityId: oppId,
      trade: "Electrical",
      channel: "call",
      reason: "prefer_email",
      actor: "op@x.invalid",
    });
    expect(await lift(s.id!, otherOrg, "intruder@x.invalid")).toBe(false);
    expect(
      await suppressionBlocking(
        { subcontractorId: subId, opportunityId: oppId, trade: "Electrical", channel: "call" },
        org
      )
    ).toBeTruthy();
  });

  it("refuses a trade-wide stop that names no bid", async () => {
    // Trade names belong to one solicitation, so "stop Electrical everywhere"
    // means whatever each analysis happened to call it.
    await expect(
      suppress({
        orgId: org,
        subcontractorId: subId,
        opportunityId: null,
        trade: "Electrical",
        channel: "call",
        reason: "prefer_email",
        actor: "op@x.invalid",
      })
    ).rejects.toThrow();
  });

  it("counts what stopping would cancel before anything is cancelled", async () => {
    const impact = await stopImpact(
      { subcontractorId: subId, opportunityId: oppId, trade: null, channel: "all" },
      org
    );
    // One pairing in 'sent' is one follow-up that would otherwise go.
    expect(impact.scheduledFollowUps).toBe(1);
    // And this firm is the only one on Electrical for this bid.
    expect(impact.uncoveredTrades).toContain("Electrical");
  });
});
