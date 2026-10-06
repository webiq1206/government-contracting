import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),one:vi.fn(),many:vi.fn()}));
vi.mock("@/lib/org-guard",()=>({requireOrgContext:mocks.auth}));
vi.mock("@/lib/db",()=>({queryOne:mocks.one,query:mocks.many}));
vi.mock("@/lib/work-mode",()=>({opportunityWorkMode:async()=>null}));
vi.mock("@/lib/app-settings",()=>({areCallsEnabled:async()=>false}));
import { GET } from "@/app/api/opportunities/[id]/preview/route";
const stale='75 points, AUTO-PURSUE and weeks remaining';
let opportunity:Record<string,unknown>|null;
beforeEach(()=>{
 vi.resetAllMocks();mocks.auth.mockResolvedValue({orgId:'synthetic-owner'});mocks.many.mockResolvedValue([]);
 opportunity={id:'synthetic',title:'Synthetic opportunity',stage:'scoring',status:'open',score:62,tier:'review',risk_flags:[],human_action_required:true,
  score_breakdown:{total:62,summary:stale},solicitation_analysis:{pursue_recommendation:stale,required_trades:[]}};
 mocks.one.mockImplementation(async(sql:string)=>sql.includes('from opportunities')?opportunity:null);
});
const call=()=>GET(new Request('https://brostco.test/api/opportunities/synthetic/preview'),{params:Promise.resolve({id:'synthetic'})});
it('keeps equal-total stale prose out of the preview and scopes the record query',async()=>{
 const response=await call();const body=await response.json();
 expect(response.status).toBe(200);expect(body.why).toBe('Current recorded score: 62/100 · Recorded tier: review');
 expect(JSON.stringify(body)).not.toContain(stale);
 expect(mocks.one).toHaveBeenCalledWith(expect.stringContaining('id=$1 and org_id=$2'),['synthetic','synthetic-owner']);
});
it('does not substitute a saved total for a missing current score',async()=>{
 opportunity!.score=null;expect((await (await call()).json()).why).toBe('Current score unavailable · Recorded tier: review');
});
it('does not show a pursuit tier for a closed record',async()=>{
 Object.assign(opportunity!,{status:'archived',stage:'call_queue',tier:'pursue',risk_flags:['expired']});
 const body=await(await call()).json();expect(body.stageLabel).toBe('Expired');expect(body.why).toBe('Current recorded score: 62/100');
});
it('preserves the market-research limitation',async()=>{
 opportunity!.is_sources_sought=true;const body=await(await call()).json();expect(body.why).toContain('market research, not a bid opportunity');expect(body.isSourcesSought).toBe(true);
});
it('keeps authentication and missing/foreign record failures unchanged',async()=>{
 mocks.auth.mockResolvedValue(NextResponse.json({error:'Unauthorized'},{status:401}));
 expect((await call()).status).toBe(401);expect(mocks.one).not.toHaveBeenCalled();
 mocks.auth.mockResolvedValue({orgId:'synthetic-owner'});opportunity=null;
 expect((await call()).status).toBe(404);expect(mocks.many).not.toHaveBeenCalled();
});
