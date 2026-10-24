import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {fitContext,type FitContextInput} from "../lib/domain/subcontractor-fit";
import {saveFitReview} from "../lib/subcontractor-fit";
import {replySendBlock} from "../lib/outreach-eligibility";
import {query,queryOne} from "../lib/db";

const d=process.env.DATABASE_URL ? describe : describe.skip;
d("source-reviewed fit in the canonical tenant schema",()=>{
  let org:string,otherOrg:string,opp:string,sub:string,pair:string,key:string;
  const trade="Alarm installation",actor=randomUUID();
  const review={affirmed:true as const,
    serviceArea:{kind:"supplier_reply" as const,reference:"synthetic-message-coverage",statement:"We cover the synthetic project site in South Dakota."},
    capability:{kind:"confirmed_call" as const,reference:"synthetic-call-scope",statement:"We install and test the specified alarm panels at this synthetic site."}};
  const send=()=>({orgId:org,opportunityId:opp,subcontractorId:sub,trade,to:"synthetic-fit@example.invalid",subject:"Fixture",html:"<p>Fixture</p>"});
  beforeAll(async()=>{
    org=(await queryOne<{id:string}>("insert into organizations(name) values('Synthetic fit review') returning id"))!.id;
    otherOrg=(await queryOne<{id:string}>("insert into organizations(name) values('Other synthetic fit tenant') returning id"))!.id;
    opp=(await queryOne<{id:string}>(`insert into opportunities(org_id,source,title,status,location_state,location_text,solicitation_analysis)
      values($1,'test','Synthetic alarm scope','open','SD','Synthetic Site, SD',$2::jsonb) returning id`,
      [org,JSON.stringify({trade_scopes:[{trade,work:"Install and test four alarm panels at the synthetic site."}]})]))!.id;
    sub=(await queryOne<{id:string}>(`insert into subcontractors(org_id,company_name,email,email_verified,state,trade_categories)
      values($1,'Synthetic guards firm','synthetic-fit@example.invalid',true,'SD',array[$2]) returning id`,[org,trade]))!.id;
    pair=(await queryOne<{id:string}>(`insert into opportunity_subs(opportunity_id,subcontractor_id,trade,outreach_state,verification_json)
      values($1,$2,$3,'pending','{"email_discovery":{"source_type":"website"}}') returning id`,[opp,sub,trade]))!.id;
    key=fitContext((await queryOne<FitContextInput>("select * from opportunities where id=$1",[opp]))!,sub,trade)!;
  });
  afterAll(async()=>{
    for(const id of [org,otherOrg]) if(id){
      await query("delete from opportunity_subs where org_id=$1",[id]);
      await query("delete from opportunities where org_id=$1",[id]);
      await query("delete from subcontractors where org_id=$1",[id]);
      await query("delete from organizations where id=$1",[id]);
    }
  });
  it("holds a nearby, verified mailbox and a search-derived trade label without real fit evidence",async()=>{
    expect(await replySendBlock(send(),org)).toMatch(/evidence has not been reviewed/);
  });
  it("refuses another tenant, absent proof and a stale page context without a write",async()=>{
    expect(await saveFitReview(otherOrg,opp,pair,actor,review,key)).toMatchObject({ok:false,status:404});
    expect(await saveFitReview(org,opp,pair,actor,{},key)).toMatchObject({ok:false,status:400});
    expect(await saveFitReview(org,opp,pair,actor,review,"old-scope")).toMatchObject({ok:false,status:409});
  });
  it("persists the scoped review with actor and readback, preserving discovery and status",async()=>{
    expect(await saveFitReview(org,opp,pair,actor,review,key)).toEqual({ok:true});
    const row=(await queryOne<{verification_json:Record<string,any>;outreach_state:string}>("select verification_json,outreach_state from opportunity_subs where id=$1",[pair]))!;
    expect(row.verification_json.outreach_fit).toMatchObject({...review,reviewedBy:actor,contextKey:key});
    expect(row.verification_json.email_discovery).toEqual({source_type:"website"});expect(row.outreach_state).toBe("pending");
    expect(await replySendBlock(send(),org)).toBeNull();
    expect((await query<{id:string}>("select id from communications where opportunity_id=$1",[opp]))).toHaveLength(0);
  });
  it("sees changed scope at the transport's fresh read instead of trusting an earlier pass",async()=>{
    await query(`update opportunities set location_text='Different synthetic site, SD' where id=$1`,[opp]);
    expect(await replySendBlock(send(),org)).toMatch(/changed after fit review/);
    expect(await saveFitReview(org,opp,pair,actor,review,key)).toMatchObject({ok:false,status:409});
  });
  it("never reopens a declined request when a reviewer saves fit evidence",async()=>{
    await query("update opportunity_subs set outreach_state='declined' where id=$1",[pair]);
    expect(await saveFitReview(org,opp,pair,actor,review,key)).toMatchObject({ok:false,status:409});
    expect(await replySendBlock(send(),org)).toMatch(/closed out/);
    expect((await queryOne<{outreach_state:string}>("select outreach_state from opportunity_subs where id=$1",[pair]))!.outreach_state).toBe("declined");
  });
});
