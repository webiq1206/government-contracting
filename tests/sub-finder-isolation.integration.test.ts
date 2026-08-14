/**
 * Two-organization isolation proof for the Sub Finder.
 *
 * The structural scan in agent-scoping.test.ts did not catch any of the
 * cross-tenant bugs found in this agent: the shapes that leaked read like
 * ordinary single-record lookups. Only running the agent twice, once per
 * organization, against real rows shows it. Org B holds a subcontractor whose
 * name cannot be mistaken for anything else, and org A's run must never reach
 * it.
 *
 * Google Places is mocked so the roster path and the Places dedupe path both
 * run deterministically, and so a test never spends a customer's Places quota.
 * The mocked candidate is one both orgs would find, which is the dedupe
 * collision that used to return, and then update, another org's row.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const B_ONLY = "ORGB-SECRET-SUB";
const A_ONLY = "ORGA-ONLY-SUB";
const SHARED = "SHARED-PLACES-FIRM";
const TRADE = "electrical";
const STATE = "CA";

vi.mock("../lib/integrations/googleMaps", () => ({
  googleMaps: {
    // The same real firm surfaces for both orgs, and org B already has it on
    // its roster. Rosters are per customer even when the firm is the same one.
    findContractors: async () => ({
      disabled: false,
      results: [
        {
          name: SHARED,
          place_id: "places-shared-listing",
          phone: "555-0100",
          website: "https://example.invalid",
          rating: 4.5,
          review_count: 40,
        },
      ],
    }),
    enrichTopN: async (r: unknown[]) => r,
  },
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("sub finder keeps organizations apart (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let subFinder: typeof import("../lib/agents/sub-finder").subFinder;

  const orgA = { id: "", name: `iso-a-${randomUUID()}`, oppId: "", subIds: [] as string[] };
  const orgB = { id: "", name: `iso-b-${randomUUID()}`, oppId: "", subIds: [] as string[] };

  async function makeOrg(o: typeof orgA, subNames: string[]) {
    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [o.name]
    );
    o.id = org!.id;

    await query(
      `insert into company_profile (org_id, version, is_active, profile_json, profile_text)
       values ($1, 1, true, $2::jsonb, $3)`,
      [
        o.id,
        JSON.stringify({
          primary_trades: [TRADE],
          sub_standards: { candidates_per_trade: 6, verify_top_n: 2 },
        }),
        `Profile for ${o.name}`,
      ]
    );

    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, location_state)
       values ($1, 'test', $2, 'sub_research', 'open', $3) returning id`,
      [o.id, `${o.name} opportunity`, STATE]
    );
    o.oppId = opp!.id;

    for (const name of subNames) {
      const sub = await queryOne<{ id: string }>(
        `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
         values ($1, $2, $3, $4, $5, true) returning id`,
        [o.id, name, [TRADE], STATE, `${name.toLowerCase()}@example.invalid`]
      );
      o.subIds.push(sub!.id);
    }
  }

  /** Every subcontractor this opportunity ended up paired with. */
  async function pairedSubs(oppId: string) {
    return query<{ id: string; company_name: string; org_id: string | null }>(
      `select s.id, s.company_name, s.org_id
         from opportunity_subs os
         join subcontractors s on s.id = os.subcontractor_id
        where os.opportunity_id = $1
        order by s.company_name`,
      [oppId]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ subFinder } = await import("../lib/agents/sub-finder"));
    await makeOrg(orgA, [A_ONLY]);
    await makeOrg(orgB, [B_ONLY, SHARED]);

    const runId = randomUUID();
    const a = await subFinder.handler({
      runId,
      trigger: "queue",
      payload: { opportunityId: orgA.oppId },
    });
    const b = await subFinder.handler({
      runId,
      trigger: "queue",
      payload: { opportunityId: orgB.oppId },
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  afterAll(async () => {
    for (const o of [orgA, orgB]) {
      if (!o.id) continue;
      await query(`delete from opportunity_subs where opportunity_id = $1`, [o.oppId]);
      await query(`delete from agent_logs where opportunity_id = $1`, [o.oppId]);
      await query(`delete from opportunities where org_id = $1`, [o.id]);
      await query(`delete from subcontractors where org_id = $1`, [o.id]);
      await query(`delete from company_profile where org_id = $1`, [o.id]);
      await query(`delete from organizations where id = $1`, [o.id]);
    }
  });

  it("pairs each organization only with its own subcontractors", async () => {
    const pairedA = await pairedSubs(orgA.oppId);
    const pairedB = await pairedSubs(orgB.oppId);

    expect(pairedA.length).toBeGreaterThan(0);
    expect(pairedB.length).toBeGreaterThan(0);
    for (const row of pairedA) expect(row.org_id).toBe(orgA.id);
    for (const row of pairedB) expect(row.org_id).toBe(orgB.id);

    expect(pairedA.map((r) => r.company_name)).toContain(A_ONLY);
    expect(pairedA.map((r) => r.company_name)).not.toContain(B_ONLY);
    for (const id of orgB.subIds) expect(pairedA.map((r) => r.id)).not.toContain(id);
    for (const id of orgA.subIds) expect(pairedB.map((r) => r.id)).not.toContain(id);
  });

  it("gives each organization its own row for the same Places listing", async () => {
    // Org B dedupes onto the roster row it already had. Org A must create its
    // own rather than adopting, and rewriting, org B's.
    const rows = await query<{ id: string; org_id: string }>(
      `select id, org_id from subcontractors
        where company_name = $1 and org_id in ($2, $3)`,
      [SHARED, orgA.id, orgB.id]
    );
    expect(rows.map((r) => r.org_id).sort()).toEqual([orgA.id, orgB.id].sort());
    expect(rows.filter((r) => r.org_id === orgB.id).map((r) => r.id)).toEqual(
      orgB.subIds.filter((id) => rows.some((r) => r.id === id))
    );
  });

  it("never leaves a subcontractor without an organization", async () => {
    // A null-org row is invisible to every org-scoped read, so the customer
    // pays for the Places lookup and then cannot see the result.
    const orphans = await query<{ count: string }>(
      `select count(*)::int as count from subcontractors
        where org_id is null and company_name in ($1, $2, $3)`,
      [A_ONLY, B_ONLY, SHARED]
    );
    expect(Number(orphans[0].count)).toBe(0);
  });

  it("does not name another organization's subcontractor in its logs", async () => {
    const logs = await query<{ message: string | null; reasoning: string | null }>(
      `select message, reasoning from agent_logs where opportunity_id = $1`,
      [orgA.oppId]
    );
    expect(logs.length).toBeGreaterThan(0);
    for (const row of logs) {
      expect(`${row.message ?? ""} ${row.reasoning ?? ""}`).not.toContain(B_ONLY);
    }
  });
});
