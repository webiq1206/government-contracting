import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({auth:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/api-auth",()=>({requireUser:mocks.auth,requireCapability:mocks.auth}));
vi.mock("@/lib/api-usage/budgets",()=>({saveBudget:mocks.save,readBudget:vi.fn()}));
import { POST } from "@/app/api/api-usage/route";
const org="00000000-0000-4000-8000-000000000002";
const body={action:"budget",orgId:"00000000-0000-4000-8000-000000000003",budget:{dailyLimit:"5",monthlyLimit:null,dailyRequests:10,paused:false,allowComplex:true}};
const request=()=>new Request("https://brostco.test/api/api-usage",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.save.mockResolvedValue(undefined);});
it.each([401,403])("denies budget changes before saving (%s)",async status=>{
  mocks.auth.mockResolvedValue(new Response("Denied",{status}));
  expect((await POST(request())).status).toBe(status);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("ignores a supplied tenant identifier and saves only the authenticated account",async()=>{
  mocks.auth.mockResolvedValue({organizationId:org,email:"owner@example.test"});
  expect((await POST(request())).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith(org,"owner@example.test",body.budget);
});
it("does not expose a database error when a budget cannot be saved",async()=>{
  mocks.auth.mockResolvedValue({organizationId:org,email:"owner@example.test"});
  mocks.save.mockRejectedValue(new Error("private database details"));
  const response=await POST(request());
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("private database");
});
