/**
 * Moving a call to a chosen time.
 *
 * The requirement is exactly one future call task, which is why this moves the
 * existing card rather than creating a second one. A control that scheduled a
 * new call and left the old one pending would produce two tasks for one
 * conversation, and the operator would find out by ringing somebody twice.
 *
 * And it is not a skip. Nothing about the subcontractor changes: no reason, no
 * scope, no suppression, no outreach state.
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

d("calling later", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/snooze/route").POST;

  const org = randomUUID();
  let oppId = "";
  let subId = "";
  let cardId = "";

  function req(body: unknown) {
    return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ POST } = await import("../app/api/snooze/route"));

    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,$2,'active',true) on conflict (id) do nothing`,
      [org, `call-later-${randomUUID()}`]
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
      `insert into opportunities (org_id, source, title, stage, status)
       values ($1,'test','Call later probe','call_queue','open') returning id`,
      [org]
    );
    oppId = opp!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, phone)
       values ($1,'Later Sparks',$2,'555-0111') returning id`,
      [org, ["Electrical"]]
    );
    subId = sub!.id;
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'Electrical','sent')`,
      [oppId, subId]
    );
    const card = await queryOne<{ id: string }>(
      `insert into call_cards (opportunity_id, subcontractor_id, card_json, status)
       values ($1,$2,'{}'::jsonb,'pending') returning id`,
      [oppId, subId]
    );
    cardId = card!.id;
  });

  afterAll(async () => {
    await query(`delete from organizations where id=$1`, [org]).catch(() => {});
    vi.restoreAllMocks();
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("moves the one card rather than creating a second", async () => {
    const when = new Date(Date.now() + 3 * 86_400_000);
    const res = await POST(req({ kind: "call_card", id: cardId, at: when.toISOString() }));
    expect(res.status).toBe(200);

    const cards = await query<{ id: string; status: string; snoozed_until: Date | null }>(
      `select id, status, snoozed_until from call_cards where opportunity_id=$1`,
      [oppId]
    );
    expect(cards).toHaveLength(1);
    // Still pending: it is happening later, not cancelled.
    expect(cards[0]?.status).toBe("pending");
    expect(cards[0]?.snoozed_until?.toISOString().slice(0, 16)).toBe(
      when.toISOString().slice(0, 16)
    );
  });

  it("records nothing about the subcontractor", async () => {
    const card = await queryOne<{
      skip_reason: string | null;
      skip_scope: string | null;
    }>(`select skip_reason, skip_scope from call_cards where id=$1`, [cardId]);
    expect(card?.skip_reason).toBeNull();
    expect(card?.skip_scope).toBeNull();

    const pairing = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2`,
      [oppId, subId]
    );
    expect(pairing?.outreach_state).toBe("sent");

    const suppressions = await query<{ id: string }>(
      `select id from outreach_suppressions where org_id=$1 and subcontractor_id=$2`,
      [org, subId]
    );
    expect(suppressions).toHaveLength(0);
  });

  it("refuses a time that has already passed", async () => {
    const res = await POST(
      req({ kind: "call_card", id: cardId, at: new Date(Date.now() - 60_000).toISOString() })
    );
    // A past time puts the card straight back on the queue, which reads as the
    // control having done nothing.
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("future");
  });

  it("refuses a time that is obviously a typo", async () => {
    const res = await POST(
      req({
        kind: "call_card",
        id: cardId,
        at: new Date(Date.now() + 3 * 365 * 86_400_000).toISOString(),
      })
    );
    expect(res.status).toBe(400);
  });

  it("refuses something that is not a time at all", async () => {
    const res = await POST(req({ kind: "call_card", id: cardId, at: "next Tuesdayish" }));
    expect(res.status).toBe(400);
  });

  it("does not move another account's card", async () => {
    const otherOrg = randomUUID();
    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,'Neighbour','active',true) on conflict (id) do nothing`,
      [otherOrg]
    );
    CURRENT = { ...(CURRENT as SessionUser), organizationId: otherOrg };
    const res = await POST(
      req({
        kind: "call_card",
        id: cardId,
        at: new Date(Date.now() + 86_400_000).toISOString(),
      })
    );
    expect(res.status).toBe(404);
    CURRENT = { ...(CURRENT as SessionUser), organizationId: org };
    await query(`delete from organizations where id=$1`, [otherOrg]).catch(() => {});
  });
});
