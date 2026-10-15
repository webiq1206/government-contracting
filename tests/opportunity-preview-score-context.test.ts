import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),one:vi.fn(),many:vi.fn(),calls:vi.fn()}));
vi.mock("@/lib/org-guard",()=>({requireOrgContext:mocks.auth}));
vi.mock("@/lib/db",()=>({queryOne:mocks.one,query:mocks.many}));
vi.mock("@/lib/work-mode",()=>({opportunityWorkMode:async()=>null}));
vi.mock("@/lib/app-settings",()=>({areCallsEnabled:mocks.calls}));
import { GET } from "@/app/api/opportunities/[id]/preview/route";
const stale='75 points, AUTO-PURSUE and weeks remaining';
let opportunity:Record<string,unknown>|null;
beforeEach(()=>{
 vi.resetAllMocks();mocks.auth.mockResolvedValue({orgId:'synthetic-owner'});mocks.many.mockResolvedValue([]);mocks.calls.mockResolvedValue(false);
 opportunity={id:'synthetic',title:'Synthetic opportunity',stage:'scoring',status:'open',score:62,tier:'review',risk_flags:[],human_action_required:true,
  score_breakdown:{total:62,summary:stale},solicitation_analysis:{pursue_recommendation:stale,required_trades:[]}};
 mocks.one.mockImplementation(async(sql:string)=>sql.includes('count(os.id)')?{count:0}:sql.includes('from opportunities')?opportunity:null);
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
it('reports a held analysis rather than claiming automatic work is running',async()=>{
 Object.assign(opportunity!,{stage:'analysis',tier:'pursue',human_action_required:true,
  risk_flags:['incomplete_solicitation','awaiting_document_analysis'],updated_at:new Date().toISOString()});
 const body=await(await call()).json();
 expect(body.nextStep.title).toBe('Review the analysis blockers');
 expect(body.nextStep.waitingOn).toBe('you');
 expect(JSON.stringify(body.nextStep)).not.toMatch(/No action required|is reading|starts automatically/);
});
it('does not claim calls or sent mail exist for an empty current subcontractor roster',async()=>{
 Object.assign(opportunity!,{stage:'call_queue',tier:'pursue',human_action_required:true});
 const body=await(await call()).json();
 expect(body.nextStep.title).toBe('Find subcontractors before requesting prices');
 expect(body.nextStep.waitingOn).toBe('you');
 expect(mocks.many).toHaveBeenCalledWith(expect.stringContaining('s.org_id=$2'),['synthetic','synthetic-owner']);
});
it('explains excluded historical links without exposing or admitting their subcontractors',async()=>{
 Object.assign(opportunity!,{stage:'call_queue',tier:'pursue',human_action_required:true});
 mocks.one.mockImplementation(async(sql:string)=>sql.includes('count(os.id)')?{count:19}:sql.includes('from opportunities')?opportunity:null);
 const body=await(await call()).json();
 expect(body.unavailableSubLinks).toBe(19);
 expect(body.nextStep.title).toBe('Review historical subcontractor links');
 expect(body.nextStep.why).toContain('19 saved links are unavailable to this organization');
 expect(body.nextStep.waitingOn).toBe('you');
 expect(mocks.many).toHaveBeenCalledWith(expect.stringContaining('s.org_id=$2'),['synthetic','synthetic-owner']);
 expect(mocks.one).toHaveBeenCalledWith(expect.stringContaining('o.id=$1 and o.org_id=$2'),['synthetic','synthetic-owner']);
});
it('does not turn a failed historical-link read into an empty roster',async()=>{
 mocks.one.mockImplementation(async(sql:string)=>sql.includes('count(os.id)')?null:sql.includes('from opportunities')?opportunity:null);
 await expect(call()).rejects.toThrow('link availability could not be established');
});
it('does not hide recorded pricing behind an unavailable historical roster',async()=>{
 Object.assign(opportunity!,{stage:'call_queue',tier:'pursue'});
 mocks.one.mockImplementation(async(sql:string)=>sql.includes('count(os.id)')?{count:19}:sql.includes('from opportunities')?opportunity:null);
 mocks.many.mockImplementation(async(sql:string)=>sql.includes('from quotes')?[{trade:'Electrical',quote_amount:1500}]:[]);
 const body=await(await call()).json();
 expect(body.unavailableSubLinks).toBe(19);
 expect(body.nextStep.title).not.toBe('Review historical subcontractor links');
 expect(body.nextStep.title).toMatch(/quote|pricing|package/i);
});
it('treats removed and declined pairings as history in the preview',async()=>{
 Object.assign(opportunity!,{stage:'call_queue',tier:'pursue'});
 mocks.many.mockImplementation(async(sql:string)=>sql.includes('from opportunity_subs')?[
  {trade:'painting',removed_at:'2026-10-01',outreach_state:'pending'},
  {trade:'painting',removed_at:null,outreach_state:'declined'},
 ]:[]);
 expect((await(await call()).json()).nextStep.title).toBe('Find subcontractors before requesting prices');
});
it('does not claim the current roster is empty when the historical pairing read is capped',async()=>{
 Object.assign(opportunity!,{stage:'call_queue',tier:'pursue'});
 mocks.calls.mockResolvedValue(true);
 mocks.many.mockImplementation(async(sql:string)=>sql.includes('from opportunity_subs')?
  Array.from({length:300},()=>({trade:'painting',removed_at:'2026-10-01',outreach_state:'pending'})):[]);
 const step=(await(await call()).json()).nextStep;
 expect(step.title).toBe('Review subcontractor calls and contact details');
 expect(step.why).toContain('has not been established');
});
