import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fetch: vi.fn(), query: vi.fn(), queryOne: vi.fn(), log: vi.fn(), cpi: vi.fn() }));
vi.mock("../lib/integrations/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/integrations/http")>(),
  fetchJson: m.fetch,
}));
vi.mock("../lib/db", () => ({ query: m.query, queryOne: m.queryOne }));
vi.mock("../lib/logger", () => ({ logAgent: m.log }));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileJson: async () => ({ pricing_rules: {} }) }));
vi.mock("../lib/integrations/bls", () => ({ bls: { getCpiSeries: m.cpi } }));

import { usaspending } from "../lib/integrations/usaspending";
import { HttpError } from "../lib/integrations/http";
import { pricingResearch } from "../lib/agents/pricing-research";

describe("award search location validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.fetch.mockResolvedValue({ results: [] });
    m.queryOne.mockResolvedValue({ id: "opp", naics_code: "238320", location_state: "KR-11" });
    m.log.mockResolvedValue(undefined);
  });

  it.each(["Idaho", " id ", "ID"])("sends %s as the supported postal code", async (state) => {
    await usaspending.searchAwards({ naics: "238320", state });
    const body = JSON.parse(m.fetch.mock.calls[0][1].body);
    expect(body.filters.place_of_performance_locations).toEqual([{ country: "USA", state: "ID" }]);
  });

  it("does not turn Seoul into a US state or substitute nationwide comparisons", async () => {
    const result = await usaspending.searchAwards({ naics: "238320", state: "KR-11" });
    expect(result.skippedReason).toContain("Review pricing manually");
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("leaves saved pricing untouched and asks for review on unsupported locations", async () => {
    const result = await pricingResearch.handler({ payload: { opportunityId: "opp" } } as Parameters<typeof pricingResearch.handler>[0]);
    expect(result).toEqual(expect.objectContaining({ ok: true, humanActionRequired: true }));
    expect(m.query).not.toHaveBeenCalled();
    expect(m.cpi).not.toHaveBeenCalled();
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", level: "warn" }));
  });

  it("preserves the API validation explanation for other rejected filters", async () => {
    m.fetch.mockRejectedValue(new HttpError(422, "422 Unprocessable Entity", { detail: "Invalid NAICS code" }));
    const result = await usaspending.searchAwards({ state: "ID", naics: "bad" });
    expect(result.error).toContain("Invalid NAICS code");
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
});
