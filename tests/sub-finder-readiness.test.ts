import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), profile: vi.fn(), search: vi.fn(), log: vi.fn() }));
vi.mock("../lib/db", () => ({ query: m.query, queryOne: m.queryOne }));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileJson: m.profile }));
vi.mock("../lib/app-settings", () => ({ getWorkExecution: async () => "sub" }));
vi.mock("../lib/tenant-context", () => ({ runWithOrg: async (_org: string, fn: () => unknown) => fn() }));
vi.mock("../lib/logger", () => ({ logAgent: m.log }));
vi.mock("../lib/integrations/googleMaps", () => ({ googleMaps: { findContractors: m.search, enrichTopN: async (rows: unknown[]) => rows } }));

import { subFinder } from "../lib/agents/sub-finder";

const readyAnalysis = () => ({ required_trades: ["HVAC"], completeness: { ok: true, missing: [] }, past_perf_classification: "team_accepted" });
function opportunity(extra: Record<string, unknown> = {}) {
  return { id: "synthetic-opp", org_id: "synthetic-org", stage: "sub_research", status: "open", pursuit_state: "active",
    location_state: "CA", location_text: "Sacramento", analysis_input_hash: "current-analysis-hash", solicitation_analysis: readyAnalysis(), ...extra };
}
const run = (trade?: string) => subFinder.handler({ runId: "synthetic-run", trigger: "queue", payload: { opportunityId: "synthetic-opp", ...(trade ? { trade } : {}) } });
function pairWrites() { return m.query.mock.calls.filter(([sql]) => String(sql).includes("insert into opportunity_subs")); }

describe("discovery rechecks the opportunity before spending or pairing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.queryOne.mockResolvedValue(opportunity());
    m.profile.mockResolvedValue({ primary_trades: ["HVAC", "Roofing"], decision_thresholds: { block_prime_only: true }, sub_standards: { candidates_per_trade: 2, verify_top_n: 1 } });
    m.query.mockImplementation(async (sql: string) => sql.includes("select id, company_name from subcontractors") ? [{ id: "synthetic-sub", company_name: "Synthetic HVAC" }] : []);
    m.search.mockResolvedValue({ results: [] });
    m.log.mockResolvedValue(undefined);
  });

  it.each([
    { name: "missing analysis", extra: { solicitation_analysis: null } },
    { name: "missing completeness snapshot", extra: { solicitation_analysis: { required_trades: ["HVAC"] } } },
    { name: "no scope to brief a sub on", extra: { solicitation_analysis: { ...readyAnalysis(), completeness: { ok: false, missing: [{ key: "scope", what: "Scope of work", critical: true }] } } } },
    { name: "no place of performance", extra: { solicitation_analysis: { ...readyAnalysis(), completeness: { ok: false, missing: [{ key: "location", what: "Place of performance", critical: true }] } } } },
    { name: "invalidated analysis after amendment", extra: { analysis_input_hash: null } },
    { name: "no source-derived trades", extra: { solicitation_analysis: { ...readyAnalysis(), required_trades: [] } } },
    { name: "prime-only company rule", extra: { solicitation_analysis: { ...readyAnalysis(), past_perf_classification: "prime_only" } } },
  ])("holds $name without discovering, pairing or moving the lifecycle", async ({ extra }) => {
    m.queryOne.mockResolvedValue(opportunity({ stage: "call_queue", ...extra }));
    const result = await run();
    expect(result.humanActionRequired).toBe(true);
    expect(result.data?.searchCompleted).toBe(false);
    expect(result.summary).toMatch(/held/i);
    expect(result.enqueued ?? []).toEqual([]);
    expect(m.search).not.toHaveBeenCalled();
    expect(pairWrites()).toEqual([]);
    expect(m.query.mock.calls.some(([sql]) => String(sql).includes("set stage="))).toBe(false);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", action: "readiness-held" }));
  });

  it("sources on gaps that only matter to the bid, which stay on the record", async () => {
    m.queryOne.mockResolvedValue(opportunity({ solicitation_analysis: { ...readyAnalysis(),
      verification_issues: ["The compliance matrix omits the letterhead requirement."],
      completeness: { ok: false, missing: [
        { key: "analysis_verification_0", what: "Source verification needs review", critical: true },
        { key: "unsupported_documents", what: "Documents in a format Brost Co could not read", critical: true },
        { key: "wage_determination", what: "Wage determination", critical: true },
      ] } } }));
    const result = await run();
    expect(result.data).toMatchObject({ searchCompleted: true, candidates: 1 });
    expect(pairWrites()).toHaveLength(1);
  });

  it("does not let a payload invent an extra trade outside the analyzed scope", async () => {
    const result = await run("Roofing");
    expect(result.summary).toMatch(/held/i);
    expect(result.enqueued ?? []).toEqual([]);
    expect(m.search).not.toHaveBeenCalled();
    expect(pairWrites()).toEqual([]);
  });

  it("keeps the ready roster and provider path working for the analyzed trade", async () => {
    const result = await run(" hvac ");
    expect(result.data).toMatchObject({ searchCompleted: true, candidates: 1, verifyEnqueued: 1 });
    expect(pairWrites()).toHaveLength(1);
    expect(pairWrites()[0][1]).toContain("HVAC");
    expect(result.enqueued?.[0]).toMatchObject({ agent: "sub-verify", payload: { trade: "HVAC", subcontractorId: "synthetic-sub" } });
  });

  it("respects an existing company rule that permits prime-only work", async () => {
    m.profile.mockResolvedValue({ decision_thresholds: { block_prime_only: false } });
    m.queryOne.mockResolvedValue(opportunity({ solicitation_analysis: { ...readyAnalysis(), past_perf_classification: "prime_only" } }));
    const result = await run();
    expect(result.data?.searchCompleted).toBe(true);
    expect(pairWrites()).toHaveLength(1);
  });
});
