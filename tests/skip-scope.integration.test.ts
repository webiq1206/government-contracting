/**
 * What a skip writes, and what it deliberately does not.
 *
 * The rule that matters is the default. A one-time skip must leave no standing
 * rule behind, because a skip that quietly created one is how an operator
 * stops speaking to a subcontractor for good on the strength of being busy on
 * a Tuesday. And a firm-wide skip must leave one, because otherwise the next
 * Call Prep run puts the card straight back and the decision was theatre.
 *
 * Asserted through the real handler against a real database.
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

d("skipping a call, and how far it reaches", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/call-cards/[id]/skip/route").POST;

  const org = randomUUID();
  let oppId = "";
  let subId = "";

  function req(body: unknown) {
    return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
  }

  async function card(): Promise<string> {
    const row = await queryOne<{ id: string }>(
      `insert into call_cards (opportunity_id, subcontractor_id, card_json, status)
       values ($1,$2,'{}'::jsonb,'pending')
       on conflict (opportunity_id, subcontractor_id)
       do update set status='pending', skip_reason=null, skip_scope=null
       returning id`,
      [oppId, subId]
    );
    return row!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ POST } = await import("../app/api/call-cards/[id]/skip/route"));

    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,$2,'active',true) on conflict (id) do nothing`,
      [org, `skip-scope-${randomUUID()}`]
    );
    CURRENT = {
      id: randomUUID(),
      email: "op@x.invalid",
      name: "Op",
      role: "member",
      orgRole: "owner",
      organizationId: org,
      subscriptionStatus: "active",
      planKey: "pro",
      trialEndsAt: null,
    } as SessionUser;

    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, pursuit_state)
       values ($1,'test','Skip probe','call_queue','open','active') returning id`,
      [org]
    );
    oppId = opp!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, phone)
       values ($1,'Busy Sparks',$2,'555-0100') returning id`,
      [org, ["Electrical"]]
    );
    subId = sub!.id;
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'Electrical','sent')`,
      [oppId, subId]
    );
  });

  afterAll(async () => {
    await query(`delete from organizations where id=$1`, [org]).catch(() => {});
    vi.restoreAllMocks();
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("writes no standing rule for a one-time skip", async () => {
    const id = await card();
    const res = await POST(req({ reason: "wrong_time", scope: "once" }), {
      params: { id },
    });
    expect(res.status).toBe(200);

    const rows = await query<{ id: string }>(
      `select id from outreach_suppressions where org_id=$1 and subcontractor_id=$2`,
      [org, subId]
    );
    expect(rows).toHaveLength(0);

    const stored = await queryOne<{
      status: string;
      skip_reason: string | null;
      skip_scope: string | null;
      dialed: boolean;
    }>(`select status, skip_reason, skip_scope, dialed from call_cards where id=$1`, [id]);
    expect(stored?.status).toBe("skipped");
    // Structured, so it can be counted rather than read.
    expect(stored?.skip_reason).toBe("wrong_time");
    expect(stored?.skip_scope).toBe("once");
    // Nobody dialled, so this is not an attempt.
    expect(stored?.dialed).toBe(false);
  });

  it("never records the subcontractor as declining or unresponsive", async () => {
    const state = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2`,
      [oppId, subId]
    );
    // Choosing not to ring somebody says nothing about them.
    expect(["declined", "unresponsive", "no_response"]).not.toContain(state?.outreach_state);
  });

  it("writes a standing rule for a firm-wide skip, and it stops the next call", async () => {
    const id = await card();
    const res = await POST(
      req({ reason: "prefer_email", scope: "subcontractor" }),
      { params: { id } }
    );
    expect(res.status).toBe(200);

    const rows = await query<{
      opportunity_id: string | null;
      trade: string | null;
      channel: string;
    }>(
      `select opportunity_id, trade, channel from outreach_suppressions
        where org_id=$1 and subcontractor_id=$2 and lifted_at is null`,
      [org, subId]
    );
    expect(rows).toHaveLength(1);
    // Every bid, every trade.
    expect(rows[0]?.opportunity_id).toBeNull();
    expect(rows[0]?.trade).toBeNull();
    // Calls only. A firm that will not take calls often still answers email.
    expect(rows[0]?.channel).toBe("call");

    const { suppressionBlocking } = await import("../lib/suppressions");
    expect(
      await suppressionBlocking(
        { subcontractorId: subId, opportunityId: randomUUID(), trade: "Roofing", channel: "call" },
        org
      )
    ).toBeTruthy();
    expect(
      await suppressionBlocking(
        { subcontractorId: subId, opportunityId: oppId, trade: "Electrical", channel: "email" },
        org
      )
    ).toBeNull();
  });

  it("keeps a free-text reason rather than dropping it", async () => {
    await query(`delete from outreach_suppressions where org_id=$1`, [org]);
    const id = await card();
    await POST(req({ reason: "He is on holiday until the 14th", scope: "once" }), {
      params: { id },
    });
    const stored = await queryOne<{ skip_reason: string | null; skip_note: string | null }>(
      `select skip_reason, skip_note from call_cards where id=$1`,
      [id]
    );
    // Not one of the named reasons, so it is not pretended to be one.
    expect(stored?.skip_reason).toBeNull();
    // But the operator wrote a sentence, and it belongs somewhere.
    expect(stored?.skip_note).toContain("holiday");
  });

  it("counts a skip as an attempt only when somebody dialled", async () => {
    const id = await card();
    await POST(req({ reason: "call_not_necessary", scope: "once", dialed: true }), {
      params: { id },
    });
    const stored = await queryOne<{ dialed: boolean }>(
      `select dialed from call_cards where id=$1`,
      [id]
    );
    expect(stored?.dialed).toBe(true);
  });
});
