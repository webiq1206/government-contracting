import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({search:vi.fn(),query:vi.fn(async()=>[])}));
vi.mock("../lib/db",()=>({query:m.query,queryOne:async()=>({id:"opp",org_id:"org",location_state:"CA",location_text:"Sacramento",solicitation_analysis:{required_trades:["HVAC"]}})}));
vi.mock("../lib/app-settings",()=>({getWorkExecution:async()=>"subcontract"}));
vi.mock("../lib/ai/companyProfile",()=>({getProfileJson:async()=>({primary_trades:["HVAC"]})}));
vi.mock("../lib/logger",()=>({logAgent:async()=>undefined}));
vi.mock("../lib/integrations/googleMaps",()=>({googleMaps:{findContractors:m.search,enrichTopN:async(v:unknown)=>v}}));
import {subFinder} from "../lib/agents/sub-finder";
beforeEach(()=>{vi.clearAllMocks();});
it.each([{disabled:true,results:[]},{error:"quota refused",results:[]},{results:null}])("does not complete exhausted second-search work after %j",async response=>{
 m.search.mockResolvedValue(response);
 const result=await subFinder.handler({runId:"run",trigger:"queue",payload:{opportunityId:"opp"}});
 expect(result.data?.searchCompleted).toBe(false);expect(result.humanActionRequired).toBe(true);
 expect(result.summary).toContain("Search incomplete");
});
it("records a genuine completed empty search distinctly from a refused one",async()=>{
 m.search.mockResolvedValue({results:[]});
 const result=await subFinder.handler({runId:"run",trigger:"queue",payload:{opportunityId:"opp"}});
 expect(result.data?.searchCompleted).toBe(true);
});

it("does not complete a successful text search whose required Details lookups failed",async()=>{
 m.search.mockResolvedValue({results:[{name:"Unknown contact",place_id:"place",detailsUnavailable:true}]});
 const result=await subFinder.handler({runId:"run",trigger:"queue",payload:{opportunityId:"opp"}});
 expect(result.data?.searchCompleted).toBe(false);expect(result.humanActionRequired).toBe(true);
});
