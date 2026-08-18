/**
 * Recording a bid outcome, against the real handler and a real database.
 *
 * Marking a win is a money action: it creates a contract, sets the active
 * revenue figure, and starts the insurance gate. It must be atomic AND
 * idempotent — a double click or a retried request must not mint a second
 * contract for the same opportunity (which would double-count revenue and the
 * non-SS subcontracting cap).
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
vi.mock("../lib/queue", () => ({ enqueue: vi.fn(async () => {}) }));

d("award outcome (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/opportunities/[id]/outcome/route").POST;
  const org = { id: "" };
  const opp = { id: "" };

  const req = (body: unknown) =>
    new Request("http://x", { method: "POST", body: JSON.stringify(body) });
  const contractCount = async () =>
    (await queryOne<{ n: number }>(`select count(*)::int as n from contracts where opportunity_id=$1`, [opp.id]))?.n ?? 0;

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ POST } = await import("../app/api/opportunities/[id]/outcome/route"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`award-${randomUUID()}`]
    );
    org.id = o!.id;
    CURRENT = {
      id: randomUUID(), email: "op@x.invalid", name: "Op", role: "member",
      organizationId: org.id, subscriptionStatus: "active", planKey: "pro", trialEndsAt: null,
    } as SessionUser;
    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, solicitation_number)
       values ($1,'test','Award job','bid_building','open','SOL-AW-1') returning id`,
      [org.id]
    );
    opp.id = op!.id;
    await query(
      `insert into bids (org_id, opportunity_id, bid_amount) values ($1,$2,125000)`,
      [org.id, opp.id]
    );
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from contracts where opportunity_id=$1`, [opp.id]).catch(() => {});
    await query(`delete from bids where org_id=$1`, [org.id]);
    await query(`delete from opportunities where org_id=$1`, [org.id]);
    await query(`delete from agent_logs where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from organizations where id=$1`, [org.id]);
    vi.restoreAllMocks();
  });

  it("recording a win creates exactly one contract and closes the opportunity", async () => {
    const res = await POST(req({ outcome: "won" }), { params: { id: opp.id } });
    expect(res.status).toBe(200);
    expect(await contractCount()).toBe(1);
    const row = await queryOne<{ stage: string; status: string }>(
      `select stage, status from opportunities where id=$1`, [opp.id]
    );
    expect(row).toMatchObject({ stage: "won", status: "closed" });
  });

  it("recording the same win again does NOT create a second contract", async () => {
    const res = await POST(req({ outcome: "won" }), { params: { id: opp.id } });
    expect(res.status).toBe(200);
    expect(await contractCount()).toBe(1); // still one, not two
  });
});
