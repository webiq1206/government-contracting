import {beforeEach,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn(),queryOne:vi.fn(),ai:vi.fn()}));
vi.mock("../lib/db",()=>({query:mocks.query,queryOne:mocks.queryOne}));
vi.mock("../lib/app-settings",()=>({areCallsEnabled:async()=>true,getWorkExecution:async()=>"sub"}));
vi.mock("../lib/auth",()=>({currentUser:async()=>null}));
vi.mock("../lib/tenant",()=>({actingOrgId:async()=>"synthetic-org"}));
vi.mock("../lib/ai/claude",()=>({completeJson:mocks.ai}));
vi.mock("../lib/logger",()=>({logAgent:async()=>{}}));
import {callPrep} from "../lib/agents/call-prep";
beforeEach(()=>{
 vi.resetAllMocks();mocks.query.mockResolvedValue([]);
 mocks.queryOne.mockResolvedValueOnce({id:"synthetic-opportunity",org_id:"synthetic-org"})
  .mockResolvedValueOnce({id:"synthetic-supplier",company_name:"Synthetic firm",phone:"5550100"})
  .mockResolvedValueOnce({id:"synthetic-pair",trade:"Restoration",outreach_state:"sent"})
  .mockResolvedValueOnce({id:"synthetic-unresolved-reply"});
});
it("skips a queued pricing call while the captured prior submission or unclear reply needs review",async()=>{
 const r=await callPrep.handler({runId:"synthetic",trigger:"queue",payload:{orgId:"synthetic-org",opportunityId:"synthetic-opportunity",subcontractorId:"synthetic-supplier"}});
 expect(r).toMatchObject({ok:true,humanActionRequired:true,summary:expect.stringContaining("No pricing call prepared")});
 expect(mocks.ai).not.toHaveBeenCalled();
 expect(mocks.query.mock.calls[0][0]).toContain("reply_review_required");
 expect(mocks.query.mock.calls[0][1]).toEqual(["synthetic-org","synthetic-opportunity","synthetic-supplier"]);
 expect(mocks.query.mock.calls.map(([sql])=>sql).join("\n")).not.toContain("insert into call_cards");
});
