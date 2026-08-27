/**
 * The five filters the Opportunities table was missing, against real rows.
 *
 * Worth an integration test rather than a unit one because four of the five
 * are SQL rather than TypeScript, and the one most likely to be wrong is the
 * trade-coverage subquery: it reads a json array the analyst wrote and
 * compares it against what an operator typed into a quote, which is two
 * different vocabularies meeting in a where clause.
 *
 * The rule each of these must not break is the same one: an unknown is not a
 * zero. A value range must never match a notice that published no value,
 * because "under $100k" would then contain every unread solicitation.
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

d("opportunity table filters (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let opportunityTable: typeof import("../lib/data").opportunityTable;

  const org = { id: "" };
  const dana = { id: "" };
  const ids: Record<string, string> = {};

  async function titlesFor(f: Parameters<typeof opportunityTable>[0]) {
    const rows = await opportunityTable(f, { limit: 50 });
    return rows.map((r) => r.title).sort();
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ opportunityTable } = await import("../lib/data"));

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`filters-${randomUUID()}`]
    );
    org.id = o!.id;
    const u = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role) values ($1,'x','Dana','operator') returning id`,
      [`f-${randomUUID()}@x.invalid`]
    );
    dana.id = u!.id;
    await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [
      org.id,
      dana.id,
    ]);
    CURRENT = {
      id: dana.id, email: "dana@x.invalid", name: "Dana", role: "member", orgRole: "owner",
      organizationId: org.id, subscriptionStatus: "active", planKey: "pro", trialEndsAt: null,
    } as SessionUser;

    async function opp(
      title: string,
      extra: {
        value?: number | null;
        confidence?: string | null;
        flags?: string[];
        trades?: string[];
        assigned?: boolean;
      } = {}
    ) {
      const row = await queryOne<{ id: string }>(
        `insert into opportunities
           (org_id, source, title, stage, status, deadline, value_estimated,
            score_breakdown, risk_flags, solicitation_analysis, assigned_to)
         values ($1,'test',$2,'bid_building','open', now() + interval '30 days', $3,
                 $4::jsonb, $5, $6::jsonb, $7)
         returning id`,
        [
          org.id,
          title,
          extra.value ?? null,
          JSON.stringify(
            extra.confidence ? { data_confidence: { level: extra.confidence, percent: 50 } } : {}
          ),
          extra.flags ?? [],
          JSON.stringify(extra.trades ? { required_trades: extra.trades } : {}),
          extra.assigned ? dana.id : null,
        ]
      );
      ids[title] = row!.id;
      return row!.id;
    }

    await opp("high confidence", { confidence: "high" });
    await opp("low confidence", { confidence: "low" });
    await opp("unscored");
    await opp("priced at 250k", { value: 250_000 });
    await opp("priced at 2m", { value: 2_000_000 });
    await opp("no published value");
    await opp("blocked one", { flags: ["missing_scope"] });
    const covered = await opp("fully covered", { trades: ["Electrical"] });
    await opp("uncovered", { trades: ["Electrical", "Plumbing"] });
    const ready = await opp("package ready");

    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
       values ($1,'Elec',$2,'TX','e@x.invalid',true) returning id`,
      [org.id, ["electrical"]]
    );
    // Lower case on purpose: the extractor writes what the solicitation said
    // and the operator types what they say. The filter compares case-blind.
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'electrical',50000)`,
      [org.id, covered, sub!.id]
    );
    // One partial: electrical quoted, plumbing not.
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'Electrical',50000)`,
      [org.id, ids["uncovered"]!, sub!.id]
    );
    await query(
      `insert into bids (org_id, opportunity_id, package_ready) values ($1,$2,true)`,
      [org.id, ready]
    );
    await query(`update opportunities set assigned_to = $2 where id = $1`, [
      ids["high confidence"]!,
      dana.id,
    ]);
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from quotes where org_id=$1`, [org.id]);
    await query(`delete from bids where org_id=$1`, [org.id]);
    await query(`delete from subcontractors where org_id=$1`, [org.id]);
    await query(`delete from opportunities where org_id=$1`, [org.id]);
    await query(`delete from organization_members where org_id=$1`, [org.id]);
    await query(`delete from organizations where id=$1`, [org.id]);
    if (dana.id) await query(`delete from users where id=$1`, [dana.id]);
    vi.restoreAllMocks();
  });

  it("filters by the confidence the scoring engine recorded", async () => {
    expect(await titlesFor({ confidence: "high" })).toEqual(["high confidence"]);
    expect(await titlesFor({ confidence: "low" })).toEqual(["low confidence"]);
  });

  it("leaves a record scored before confidence existed out of every band", async () => {
    /*
     * Its confidence is not low, it is unrecorded, and putting it in the low
     * bucket would be the interface asserting something nobody measured.
     */
    for (const level of ["high", "medium", "low"] as const) {
      expect(await titlesFor({ confidence: level })).not.toContain("unscored");
    }
  });

  it("never puts an unpublished value inside a value range", async () => {
    // "Under $100k" containing every unread notice is the same lie as printing
    // 0 for an unknown count, told about money.
    const cheap = await titlesFor({ valueMax: 100_000 });
    expect(cheap).not.toContain("no published value");
    expect(cheap).not.toContain("unscored");
    expect(await titlesFor({ valueMin: 100_000, valueMax: 1_000_000 })).toEqual(["priced at 250k"]);
  });

  it("finds the rows automation stopped on", async () => {
    expect(await titlesFor({ blocked: true })).toEqual(["blocked one"]);
  });

  it("finds a required trade nobody has quoted, case-blind", async () => {
    const uncovered = await titlesFor({ uncovered: true });
    expect(uncovered).toContain("uncovered");
    // Quoted as "electrical" against a required "Electrical". Two vocabularies
    // meeting in a where clause, and a case-sensitive compare would report
    // this bid as uncovered and send somebody chasing a quote they have.
    expect(uncovered).not.toContain("fully covered");
  });

  it("separates a validated package from one that is not", async () => {
    expect(await titlesFor({ readiness: "ready" })).toEqual(["package ready"]);
    expect(await titlesFor({ readiness: "not_ready" })).not.toContain("package ready");
  });

  it("cuts by owner in both directions", async () => {
    expect(await titlesFor({ owner: "mine", viewerId: dana.id })).toEqual(["high confidence"]);
    const unassigned = await titlesFor({ owner: "unassigned" });
    expect(unassigned).not.toContain("high confidence");
    expect(unassigned).toContain("blocked one");
  });

  it("combines without contradicting itself", async () => {
    const rows = await titlesFor({
      uncovered: true,
      readiness: "not_ready",
      owner: "unassigned",
    });
    expect(rows).toEqual(["uncovered"]);
  });
});
