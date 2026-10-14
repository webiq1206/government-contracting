import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), evidence: vi.fn(), budget: vi.fn(), route: vi.fn() }));
vi.mock("../lib/platform-admin", () => ({ requirePlatformAdmin: state.auth }));
vi.mock("../lib/db", () => ({ query: state.query }));
vi.mock("../lib/ai/provider-facts", () => ({ currentProviderEvidence: state.evidence }));
vi.mock("../lib/ai/claude", () => ({ planRoute: state.route, routingConfig: () => ({ fallback: false, openai:{model:"gpt-6-luna",modelSmart:"gpt-6-sol"}, anthropic:{model:"claude-haiku-4-5-20251001",modelSmart:"claude-haiku-4-5-20251001"} }) }));
vi.mock("../lib/api-usage/budgets", () => ({ readBudget: state.budget }));
import { GET } from "../app/api/admin/ai-readiness/route";
import { LEGACY_ORG_ID } from "../lib/tenant-context";
beforeEach(() => {
 vi.clearAllMocks(); state.auth.mockResolvedValue({ id: "admin" }); state.query.mockResolvedValue([]);
 state.budget.mockResolvedValue({ daily_limit: "50" }); state.route.mockResolvedValue(null);
 state.evidence.mockResolvedValue({ configured: true, source: "platform", facts: {
   pending_attempt: "private-attempt-token", credential_hash: "private-hash", refusal_reason: "saved hold"
 } });
});
it.each([401,403])("requires platform authorization before reading readiness: %s",async status=>{
 state.auth.mockResolvedValue(new Response("Denied",{status}));
 expect((await GET()).status).toBe(status);
 expect(state.query).not.toHaveBeenCalled();expect(state.evidence).not.toHaveBeenCalled();expect(state.budget).not.toHaveBeenCalled();
});
it("reads only BrostCo evidence without exposing receipt handles or implying spending approval",async()=>{
 const response=await GET();const body=await response.json();
 expect(response.status).toBe(200);expect(body.organizationId).toBe(LEGACY_ORG_ID);
 expect(body.spendingAuthorization).toContain("not evidence");
 expect(JSON.stringify(body)).not.toMatch(/private-attempt-token|private-hash/);
 expect(body.providers[0]).toMatchObject({pending:true,refusal:"saved hold"});
 expect(state.budget).toHaveBeenCalledWith(LEGACY_ORG_ID);
 for(const call of state.evidence.mock.calls)expect(call[1]).toBe(LEGACY_ORG_ID);
 for(const call of state.query.mock.calls)expect(call[0].trim()).toMatch(/^select /i);
 expect(state.query.mock.calls[0][1]).toEqual([LEGACY_ORG_ID]);
 expect(state.query.mock.calls[1][1][0]).toEqual(["gpt-6-luna","gpt-6-sol"]);
 expect(body.candidateContract.liveQualityVerified).toBe(false);
});
it("fails closed without returning partial readiness when one source fails",async()=>{
 state.query.mockRejectedValue(new Error("private database details"));
 const response=await GET();expect(response.status).toBe(503);
 expect(JSON.stringify(await response.json())).not.toContain("private database details");
});
