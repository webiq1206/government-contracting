/**
 * What the submit gate refuses now that the pricing sheet feeds it, and what
 * approving a package writes down.
 *
 * The gate used to ask one question: does every required trade have a positive
 * quote row. A bid could pass that and still be unpriceable in three other
 * ways, each of which produces a number that looks like a cost and is not one:
 * a subcontractor excluded work and nobody picked it up, an alternate went
 * into the bid with no price on it, or several firms quoted the same trade and
 * nobody chose between them.
 *
 * Asserted against the real handler and a real database, because the last four
 * columns this work assumed into existence were all caught this way.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../lib/auth";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

let CURRENT: SessionUser | null = null;
vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: vi.fn(async () => CURRENT) };
});
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

d("the pricing sheet as the submit gate", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/opportunities/[id]/submit/route").POST;
  let savePricingRow: typeof import("../lib/pricing-rows").savePricingRow;
  let snapshotsFor: typeof import("../lib/pricing-rows").snapshotsFor;

  const org = { id: "" };
  let sub = "";

  function req(body: unknown = {}) {
    return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
  }

  /** A fresh opportunity with a ready bid package and one required trade. */
  async function scenario(trades: string[]): Promise<{ oppId: string; bidId: string }> {
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline, solicitation_analysis)
       values ($1,'test','Priced job','bid_building','open', now() + interval '30 days', $2::jsonb)
       returning id`,
      [org.id, JSON.stringify({ required_trades: trades })]
    );
    const bid = await queryOne<{ id: string }>(
      `insert into bids (org_id, opportunity_id, package_ready, submission_state,
                         validation_json, audit_findings, bid_amount)
       values ($1,$2,true,'package_ready','{"blockers":[]}'::jsonb,'[]'::jsonb, 130000)
       returning id`,
      [org.id, opp!.id]
    );
    return { oppId: opp!.id, bidId: bid!.id };
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ POST } = await import("../app/api/opportunities/[id]/submit/route"));
    ({ savePricingRow, snapshotsFor } = await import("../lib/pricing-rows"));

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status, billing_exempt)
       values ($1,'active',true) returning id`,
      [`pricing-gate-${randomUUID()}`]
    );
    org.id = o!.id;
    CURRENT = {
      id: randomUUID(),
      email: "op@x.invalid",
      name: "Op",
      role: "member",
      orgRole: "owner",
      organizationId: org.id,
      subscriptionStatus: "active",
      planKey: "pro",
      trialEndsAt: null,
    } as SessionUser;
    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
       values ($1,'Sparks',$2,'CA','e@x.invalid',true) returning id`,
      [org.id, ["electrical"]]
    );
    sub = s!.id;
  });

  afterAll(async () => {
    if (org.id) await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
    vi.restoreAllMocks();
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("refuses when excluded work has nobody carrying it, and force does not help", async () => {
    const { oppId } = await scenario(["electrical"]);
    await savePricingRow({
      orgId: org.id,
      opportunityId: oppId,
      trade: "electrical",
      selectedSubId: sub,
      baseQuote: 100_000,
      confidence: "firm",
      exclusions: [{ text: "Crane and rigging", covered_by: "unassigned" }],
      actor: "op@x.invalid",
    });
    const res = await POST(
      req({ override: { requirement: "Pricing", reason: "We will sort the crane out on site." } }),
      { params: { id: oppId } }
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.needsForce).toBe(false);
    expect(JSON.stringify(json)).toContain("Crane and rigging");
    const state = await queryOne<{ submission_state: string }>(
      `select submission_state from bids where opportunity_id=$1`,
      [oppId]
    );
    expect(state?.submission_state).toBe("package_ready");
  });

  it("refuses an alternate that is in the bid with no price on it", async () => {
    const { oppId } = await scenario(["electrical"]);
    await savePricingRow({
      orgId: org.id,
      opportunityId: oppId,
      trade: "electrical",
      selectedSubId: sub,
      baseQuote: 100_000,
      confidence: "firm",
      alternates: [{ label: "Add generator", amount: null, included: true }],
      actor: "op@x.invalid",
    });
    const res = await POST(req({}), { params: { id: oppId } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("Add generator");
  });

  it("refuses a component flagged as applying with no figure behind it", async () => {
    const { oppId } = await scenario(["electrical"]);
    await savePricingRow({
      orgId: org.id,
      opportunityId: oppId,
      trade: "electrical",
      selectedSubId: sub,
      baseQuote: 100_000,
      confidence: "firm",
      pendingComponents: ["freight"],
      actor: "op@x.invalid",
    });
    const res = await POST(req({}), { params: { id: oppId } });
    expect(res.status).toBe(409);
    // Not "the bid is 100,000 and freight was nothing".
    expect(JSON.stringify(await res.json())).toContain("freight");
  });

  it("approves a sound sheet and freezes the arithmetic behind the decision", async () => {
    const { oppId, bidId } = await scenario(["electrical"]);
    await savePricingRow({
      orgId: org.id,
      opportunityId: oppId,
      trade: "electrical",
      selectedSubId: sub,
      baseQuote: 100_000,
      confidence: "firm",
      quoteExpiresOn: "2099-01-01",
      actor: "op@x.invalid",
    });
    const res = await POST(req({}), { params: { id: oppId } });
    expect(res.status).toBe(200);

    const state = await queryOne<{ submission_state: string; submitted_at: Date | null }>(
      `select submission_state, submitted_at from bids where id=$1`,
      [bidId]
    );
    expect(state?.submission_state).toBe("approved");
    // Approving is not sending, and nothing here claims it was.
    expect(state?.submitted_at).toBeNull();

    const snaps = await snapshotsFor(bidId, org.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.reason).toBe("approved");
    const calc = snaps[0]!.calculation as {
      cost: number;
      bid: number;
      marginPct: number;
      markupPct: number;
      rows: { trade: string; total: number }[];
    };
    expect(calc.cost).toBe(100_000);
    expect(calc.bid).toBe(130_000);
    // Margin is profit over the bid; markup is profit over the cost. Both are
    // in the frozen copy and they are not the same number.
    expect(calc.marginPct).toBeCloseTo(23.08, 1);
    expect(calc.markupPct).toBe(30);
    expect(calc.rows[0]?.trade).toBe("electrical");

    // And the frozen copy cannot be edited afterwards.
    await expect(
      query(`update bid_calculation_snapshots set calculation='{}'::jsonb where bid_id=$1`, [bidId])
    ).rejects.toThrow(/immutable/);
  });

  it("does not choose between competing quotes to get a package out", async () => {
    const { oppId } = await scenario(["electrical"]);
    const other = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories)
       values ($1,'Other Sparks',$2) returning id`,
      [org.id, ["electrical"]]
    );
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'electrical',88000), ($1,$2,$4,'electrical',94000)`,
      [org.id, oppId, sub, other!.id]
    );
    const res = await POST(req({}), { params: { id: oppId } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("none has been chosen");
  });
});
