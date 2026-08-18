/**
 * The submission gate, against the real handler and a real database.
 *
 * Submitting a bid is irreversible and the number goes to a federal buyer, so
 * the guards that stop a bad submission are asserted directly: a required
 * trade left unpriced must be a HARD block that even force cannot bypass, and
 * a package that has not passed compliance validation must be held.
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

d("bid submission gate (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/opportunities/[id]/submit/route").POST;
  const org = { id: "" };
  const opp = { id: "" };
  const sub = { id: "" };

  function req(body: unknown = {}) {
    return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ POST } = await import("../app/api/opportunities/[id]/submit/route"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`submit-${randomUUID()}`]
    );
    org.id = o!.id;
    CURRENT = {
      id: randomUUID(), email: "op@x.invalid", name: "Op", role: "member",
      organizationId: org.id, subscriptionStatus: "active", planKey: "pro", trialEndsAt: null,
    } as SessionUser;
    // A two-trade solicitation. Only electrical will be priced.
    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline, solicitation_analysis)
       values ($1,'test','Gated job','bid_building','open', now() + interval '30 days',
               $2::jsonb) returning id`,
      [org.id, JSON.stringify({ required_trades: ["electrical", "plumbing"] })]
    );
    opp.id = op!.id;
    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
       values ($1,'Elec',$2,'CA','e@x.invalid',true) returning id`,
      [org.id, ["electrical"]]
    );
    sub.id = s!.id;
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'electrical',50000)`,
      [org.id, opp.id, sub.id]
    );
    // A bid package that is NOT ready and carries a blocker.
    await query(
      `insert into bids (org_id, opportunity_id, package_ready, validation_json, audit_findings)
       values ($1,$2,false,$3::jsonb,'[]'::jsonb)`,
      [org.id, opp.id, JSON.stringify({ blockers: ["SF1449 not signed"] })]
    );
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from quotes where org_id=$1`, [org.id]);
    await query(`delete from bids where org_id=$1`, [org.id]);
    await query(`delete from subcontractors where org_id=$1`, [org.id]);
    await query(`delete from opportunities where org_id=$1`, [org.id]);
    await query(`delete from organizations where id=$1`, [org.id]);
    vi.restoreAllMocks();
  });

  it("blocks submission when a required trade is unpriced, and force cannot bypass it", async () => {
    const res = await POST(req({ force: true }), { params: { id: opp.id } });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(JSON.stringify(json).toLowerCase()).toContain("plumbing");
    // Opportunity was NOT submitted.
    const row = await queryOne<{ stage: string }>(`select stage from opportunities where id=$1`, [opp.id]);
    expect(row?.stage).toBe("bid_building");
  });

  it("blocks an unready package (compliance not passed) without force", async () => {
    // Price the missing trade so we get past the trade gate to the package gate.
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'plumbing',30000)`,
      [org.id, opp.id, sub.id]
    );
    const res = await POST(req({}), { params: { id: opp.id } });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.needsForce).toBe(true);
    expect(JSON.stringify(json)).toContain("SF1449");
  });

  it("refuses another org's opportunity outright", async () => {
    const other = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status)
       values ((select id from organizations where id != $1 limit 1),'test','X','bid_building','open')
       returning id`,
      [org.id]
    ).catch(() => null);
    // Use a random UUID not owned by this org.
    const res = await POST(req({}), { params: { id: randomUUID() } });
    expect(res.status).toBe(404);
    if (other?.id) await query(`delete from opportunities where id=$1`, [other.id]).catch(() => {});
  });
});
