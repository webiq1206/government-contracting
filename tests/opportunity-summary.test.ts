import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../lib/db", () => ({ query: m.query, queryOne: vi.fn() }));
vi.mock("../lib/tenant", () => ({ resolveTenantOrgId: async () => "tenant-a" }));
import { pipelineOpportunities, opportunityTable } from "../lib/data";

describe("opportunity summary reads", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create table opportunities (
      id text, org_id text, solicitation_number text, title text, naics_code text,
      set_aside_type text, value_estimated numeric, value_estimated_source text,
      deadline timestamptz, posted_at timestamptz, location_state text, agency text,
      sub_agency text, score numeric, score_breakdown jsonb, tier text, risk_flags text[],
      stage text, status text, human_action_required boolean, snoozed_until timestamptz,
      pursuit_state text, created_at timestamptz, updated_at timestamptz,
      description text, raw_json jsonb, attachments_json jsonb, solicitation_analysis jsonb
    )`);
    for (const [id, org, status] of [["ours", "tenant-a", "open"], ["theirs", "tenant-b", "open"], ["closed", "tenant-a", "archived"]]) {
      await db.query(`insert into opportunities
        (id, org_id, title, solicitation_number, stage, status, pursuit_state, deadline,
         naics_code, score, value_estimated, score_breakdown, description, raw_json)
        values ($1,$2,'Painting','SOL-42','analysis',$3,'active',now()+interval '30 days',
          '238320',78,42500,'{"data_confidence":{"level":"high"}}',$4,$5::jsonb)`,
        [id, org, status, "Full solicitation. ".repeat(10000), JSON.stringify({ source: "large document ".repeat(10000) })]);
    }
    m.query.mockImplementation(async (sql, params) => (await db.query(sql, params)).rows);
  }, 30000);
  afterAll(async () => { await db?.close(); });

  it.each(["board", "table"])("keeps %s reads small, accurate and tenant scoped", async (view) => {
    const rows = view === "board" ? await pipelineOpportunities() : await opportunityTable({}, { limit: 25 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "ours", title: "Painting", solicitation_number: "SOL-42", naics_code: "238320", value_estimated: "42500", score_breakdown: { data_confidence: { level: "high" } } });
    expect(JSON.stringify(rows).length).toBeLessThan(2000);
    expect(rows[0]).not.toHaveProperty("description");
    expect(rows[0]).not.toHaveProperty("raw_json");
    expect(rows[0]).not.toHaveProperty("solicitation_analysis");
  });
});
