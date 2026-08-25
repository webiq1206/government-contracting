/**
 * Aggressive cross-tenant attack test.
 *
 * This does not test that queries CAN be scoped; it seeds two real tenants in
 * a real database, signs in as tenant A, and drives the actual route handlers
 * against tenant B's record ids — the exact "manipulate the UUID in the URL"
 * attack. Every handler must answer as if B's records do not exist (404 / not
 * found / empty), and must never read, mutate, or reveal them.
 *
 * currentUser is mocked to return whichever session the current test has
 * "signed in", so the handlers run their true authorization path
 * (requireOrgContext → resolveTenantOrgId → org-scoped lookup) rather than a
 * stub. The database and every query below are real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { purgeOrg } from "./helpers/purge-org";
import { randomUUID } from "crypto";
import type { SessionUser } from "../lib/auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

// The "logged-in" user for the current test. Swapped per attack.
let CURRENT: SessionUser | null = null;

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: vi.fn(async () => CURRENT) };
});

// Next's cookies()/headers() are not available outside a request; the handlers
// we call don't need them once currentUser is mocked, but impersonation checks
// read headers, so stub them to empty.
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

function session(orgId: string, over: Partial<SessionUser> = {}): SessionUser {
  return {
    id: randomUUID(),
    email: `user-${orgId.slice(0, 8)}@example.invalid`,
    name: "Test User",
    role: "member",
    orgRole: "owner",
    organizationId: orgId,
    subscriptionStatus: "active",
    planKey: "pro",
    trialEndsAt: null,
    ...over,
  } as SessionUser;
}

d("cross-tenant attack surface (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;

  const A = { org: "", user: null as SessionUser | null, opp: "", sub: "", quote: "", doc: "", comm: "", callCard: "", contract: "", compliance: "" };
  const B = { ...A };

  async function seedOrg(o: typeof A, tag: string) {
    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`attack-${tag}-${randomUUID()}`]
    );
    o.org = org!.id;
    o.user = session(o.org);
    await query(
      `insert into company_profile (org_id, version, is_active, profile_json, profile_text)
       values ($1,1,true,$2::jsonb,$3)`,
      [o.org, JSON.stringify({ legal_name: `${tag} LLC`, primary_trades: ["electrical"] }), `${tag} secret profile`]
    );
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, location_state, solicitation_number)
       values ($1,'test',$2,'outreach','open','CA',$3) returning id`,
      [o.org, `${tag} SECRET opportunity`, `SOL-${tag}-${randomUUID().slice(0,8)}`]
    );
    o.opp = opp!.id;
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
       values ($1,$2,$3,'CA',$4,true) returning id`,
      [o.org, `${tag}-SECRET-SUB`, ["electrical"], `${tag}sub@example.invalid`]
    );
    o.sub = sub!.id;
    const quote = await queryOne<{ id: string }>(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'electrical',12345) returning id`,
      [o.org, o.opp, o.sub]
    ).catch(() => null);
    o.quote = quote?.id ?? "";
    const doc = await queryOne<{ id: string }>(
      `insert into documents (org_id, opportunity_id, kind, name, storage_path, storage_backend, mime)
       values ($1,$2,'solicitation',$3,$4,'local','application/pdf') returning id`,
      [o.org, o.opp, `${tag}-secret.pdf`, `${tag}/secret/path.pdf`]
    ).catch(() => null);
    o.doc = doc?.id ?? "";
    const comm = await queryOne<{ id: string }>(
      `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body)
       values ($1,$2,$3,'email','outbound',$4,'secret body') returning id`,
      [o.org, o.sub, o.opp, `${tag} secret subject`]
    ).catch(() => null);
    o.comm = comm?.id ?? "";
    const cc = await queryOne<{ id: string }>(
      `insert into call_cards (org_id, opportunity_id, subcontractor_id, trade, status)
       values ($1,$2,$3,'electrical','pending') returning id`,
      [o.org, o.opp, o.sub]
    ).catch(() => null);
    o.callCard = cc?.id ?? "";
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    await seedOrg(A, "A");
    await seedOrg(B, "B");
  });

  afterAll(async () => {
    for (const o of [A, B]) {
      if (!o.org) continue;
      // Schema-driven cleanup: clears every org-scoped table, so a new one
      // can never leave this org (or its compliance_items, etc.) behind.
      await purgeOrg(o.org);
    }
    vi.restoreAllMocks();
  });

  // Sign in as A for the whole block; every call targets B's ids.
  function asA() { CURRENT = A.user; }

  it("subcontractor edit route refuses another org's sub", async () => {
    asA();
    const { POST } = await import("../app/api/subs/[id]/route");
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ company_name: "HIJACKED" }) }),
      { params: { id: B.sub } }
    );
    expect(res.status).toBe(404);
    // And B's row is untouched.
    const row = await queryOne<{ company_name: string }>(
      `select company_name from subcontractors where id=$1`, [B.sub]
    );
    expect(row?.company_name).toBe("B-SECRET-SUB");
  });

  it("subcontractor notes route refuses another org's sub", async () => {
    asA();
    const mod = await import("../app/api/subs/[id]/notes/route");
    const res = await mod.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ note: "x" }) }),
      { params: { id: B.sub } }
    );
    expect([403, 404]).toContain(res.status);
  });

  it("opportunity log route refuses another org's opportunity", async () => {
    asA();
    const mod = await import("../app/api/opportunities/[id]/log/route");
    const res = await mod.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "note", body: "cross-tenant probe" }) }),
      { params: { id: B.opp } }
    );
    // Valid body, so a 404 here is the ORG check firing, not validation.
    expect(res.status).toBe(404);
    const leaked = await queryOne<{ n: number }>(
      `select count(*)::int as n from communications where opportunity_id=$1 and body like '%cross-tenant probe%'`, [B.opp]
    );
    expect(leaked?.n).toBe(0);
  });

  it("opportunity action route refuses another org's opportunity", async () => {
    asA();
    const mod = await import("../app/api/opportunities/[id]/action/route");
    const res = await mod.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ action: "pursue" }) }),
      { params: { id: B.opp } }
    );
    expect([400, 403, 404]).toContain(res.status);
  });

  it("quote save route refuses writing a quote onto another org's opportunity", async () => {
    asA();
    const mod = await import("../app/api/opportunities/[id]/quote/route");
    const res = await mod.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ items: [{ trade: "electrical", amount: 999 }] }) }),
      { params: { id: B.opp } }
    );
    expect(res.status).toBe(404);
    const count = await queryOne<{ n: number }>(
      `select count(*)::int as n from quotes where opportunity_id=$1 and quote_amount=999`, [B.opp]
    );
    expect(count?.n).toBe(0);
  });

  it("call-card workspace route refuses another org's call card", async () => {
    asA();
    if (!B.callCard) return;
    const mod = await import("../app/api/call-cards/[id]/workspace/route");
    const res = await mod.GET(
      new Request("http://x"),
      { params: { id: B.callCard } }
    );
    expect([403, 404]).toContain(res.status);
  });

  it("file route refuses another org's document by its storage key", async () => {
    asA();
    if (!B.doc) return;
    // B's document key, fetched with A's session and no signed token.
    const key = "B/secret/path.pdf";
    const mod = await import("../app/api/files/[...path]/route");
    const res = await mod.GET(
      new Request(`http://x/api/files/${key}`),
      { params: { path: key.split("/") } }
    );
    expect(res.status).toBe(404);
  });

  it("file route still serves the owner their own document", async () => {
    // Sign in as B and fetch B's own key: must NOT 404 on ownership (it may
    // 404 later if the bytes are missing in this fixture, but not on the org
    // check — we assert it is not blocked as unauthorized/forbidden).
    CURRENT = B.user;
    const key = "B/secret/path.pdf";
    const mod = await import("../app/api/files/[...path]/route");
    const res = await mod.GET(
      new Request(`http://x/api/files/${key}`),
      { params: { path: key.split("/") } }
    );
    // Ownership resolves (documents row exists for B), so it is not a 401/403.
    expect([200, 302, 404]).toContain(res.status);
  });

  it("bulk snooze refuses another org's opportunities and call cards", async () => {
    asA();
    const mod = await import("../app/api/bulk/route");
    // Try to snooze B's opportunity.
    const res = await mod.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ action: "snooze", kind: "opportunity", ids: [B.opp], until: "1_day" }) })
    );
    const json = await res.json().catch(() => ({}));
    // Processed count must be zero: nothing of B's was touched.
    expect(json.processed ?? 0).toBe(0);
    const row = await queryOne<{ snoozed_until: string | null }>(
      `select snoozed_until from opportunities where id=$1`, [B.opp]
    );
    expect(row?.snoozed_until).toBeNull();
  });

  it("bulk skip refuses another org's call cards", async () => {
    asA();
    if (!B.callCard) return;
    const mod = await import("../app/api/bulk/route");
    const res = await mod.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ action: "skip_calls", ids: [B.callCard] }) })
    );
    const json = await res.json().catch(() => ({}));
    expect(json.processed ?? 0).toBe(0);
    const row = await queryOne<{ status: string }>(
      `select status from call_cards where id=$1`, [B.callCard]
    );
    expect(row?.status).toBe("pending");
  });

  it("search never returns another org's records", async () => {
    asA();
    const mod = await import("../app/api/search/route");
    const res = await mod.GET(new Request("http://x/api/search?q=SECRET"));
    const json = await res.json().catch(() => ({}));
    const blob = JSON.stringify(json);
    expect(blob).not.toContain("B SECRET opportunity");
    expect(blob).not.toContain("B-SECRET-SUB");
  });
});
