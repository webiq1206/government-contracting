import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCompanyProfile } from "@/lib/domain/default-profile";
import { DEFAULT_RULES } from "@/lib/domain/intake";

const m = vi.hoisted(() => ({ query: vi.fn(), one: vi.fn(), profile: vi.fn(), ai: vi.fn(), rules: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query, queryOne: m.one }));
vi.mock("@/lib/ai/companyProfile", () => ({ getProfileJson: m.profile }));
vi.mock("@/lib/ai/claude", () => ({ completeJson: m.ai, ClaudeNotConfiguredError: class extends Error {} }));
vi.mock("@/lib/logger", () => ({ logAgent: vi.fn() }));
vi.mock("@/lib/app-settings", () => ({ getAutomationRules: m.rules }));
vi.mock("@/lib/opportunity-description", () => ({ ensureNoticeDescription: vi.fn(async () => null) }));
vi.mock("@/lib/ai/contentLibrary", () => ({ retrieveRelevantContent: vi.fn(), renderContentForPrompt: vi.fn() }));
vi.mock("@/lib/integrations/storage", () => ({ storage: {} }));
vi.mock("@/lib/integrations/documents", () => ({ documents: {} }));
import { scoringEngine } from "@/lib/agents/scoring-engine";
import { sourcesSoughtResponder } from "@/lib/agents/sources-sought-responder";

const orgId = "11111111-1111-4111-8111-111111111111";
const base = { id: "opp", org_id: orgId, title: "HVAC repair", description: "Repair air conditioning equipment.", stage: "monitoring", status: "open", value_estimated: 200000, set_aside_type: "Total Small Business", naics_code: "238220", deadline: new Date(Date.now() + 30 * 86400000).toISOString(), attachments_json: [{ url: "https://example.com/scope.pdf" }] };
const ctx = { runId: "test", trigger: "queue" as const, payload: { opportunityId: "opp" } };
let opp: typeof base;
beforeEach(() => {
  vi.resetAllMocks();
  opp = { ...base };
  m.one.mockImplementation(async (sql: string) => sql.includes("select * from opportunities") ? opp : { n: 0 });
  m.query.mockResolvedValue([]);
  m.profile.mockResolvedValue(defaultCompanyProfile({ legalName: "Test Co", email: "test@example.com" }));
  m.rules.mockResolvedValue(DEFAULT_RULES);
});
describe("paid analysis admission", () => {
  it.each([{ set_aside_type: "HUBZone Set Aside", expected: "ineligible_set_aside" }, { value_estimated: 5000, expected: "value_below_min" }])("holds known disqualification $expected before paid analysis", async ({ expected, ...patch }) => {
    opp = { ...opp, ...patch };
    const result = await scoringEngine.handler(ctx);
    expect(result.humanActionRequired).toBe(true);
    expect(result.summary).toContain(expected);
    expect(result.enqueued).toBeUndefined();
    expect(m.ai).not.toHaveBeenCalled();
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("where id=$1 and org_id=$3"), ["opp", expect.arrayContaining([`pre_analysis_${expected}`]), orgId]);
    expect(m.query.mock.calls.some(([sql]) => String(sql).includes("status='archived'"))).toBe(false);
  });
  it("keeps unknown-value opportunities eligible for a full document read", async () => {
    opp = { ...opp, value_estimated: null as unknown as number };
    const result = await scoringEngine.handler(ctx);
    expect(result.enqueued?.[0].agent).toBe("solicitation-analyst");
  });
  it("does not apply the preliminary hold to an active pursuit", async () => {
    opp = { ...opp, stage: "outreach", value_estimated: 5000 };
    const result = await scoringEngine.handler(ctx);
    expect(result.enqueued?.[0].agent).toBe("solicitation-analyst");
  });
  it("permits explicit lifecycle-preserving document recovery", async () => {
    opp = { ...opp, value_estimated: 5000 };
    const result = await scoringEngine.handler({ ...ctx, payload: { ...ctx.payload, preserveLifecycle: true } });
    expect(result.enqueued?.[0].agent).toBe("solicitation-analyst");
  });
  it("does not buy another Sources Sought draft when one already exists", async () => {
    m.one.mockImplementation(async (sql: string) => sql.includes("select * from opportunities") ? opp : { id: "saved-draft" });
    const result = await sourcesSoughtResponder.handler(ctx);
    expect(result.summary).toContain("without another paid draft");
    expect(m.ai).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
    expect(m.one).toHaveBeenCalledWith(expect.stringContaining("org_id=$2"), ["opp", orgId]);
  });
});
