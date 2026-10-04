import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {randomUUID} from "node:crypto";
const state=vi.hoisted(()=>({db:null as PGlite|null,paused:false,suppressed:false,stopped:false,support:false}));
vi.mock("../lib/db",()=>({queryOne:async(sql:string,p:unknown[]=[]) => (await state.db!.query(sql,p)).rows[0]??null}));
vi.mock("../lib/work-mode",()=>({opportunityOutreachAllowed:async()=>true}));
vi.mock("../lib/impersonation",()=>({currentImpersonator:async()=>state.support?"admin":null}));
vi.mock("../lib/app-settings",()=>({isAutomationStopped:async()=>state.paused,AUTOMATION_PAUSED_ERROR:"paused"}));
vi.mock("../lib/domain/email-suppression",()=>({isSuppressed:async()=>state.suppressed}));
vi.mock("../lib/suppressions",()=>({suppressionBlocking:async()=>state.stopped?{}:null}));
vi.mock("../lib/domain/suppression",()=>({describeSuppression:()=>"stopped"}));
vi.mock("../lib/billing/trial-limits",()=>({checkTrialQuota:async()=>({allowed:true})}));
vi.mock("../lib/domain/sender-identity",()=>({resolveOutreachSender:async()=>({connected:true,from:"owner@example.test",replyTo:"owner@example.test"})}));
vi.mock("../lib/integrations/gmail",()=>({gmail:{isConnected:async()=>true,send:vi.fn(async(p:any)=>{await p.beforeProviderSend?.("owner@example.test");return {messageId:"receipt",outcome:"accepted"};})}}));
import {sendOutreachEmail, type OutreachSendParams} from "../lib/integrations/email-transport";
import {gmail} from "../lib/integrations/gmail";
import {runWithPursuitVersion} from "../lib/pursuit-job-context";
let params:OutreachSendParams;
beforeAll(async()=>{state.db=new PGlite();await state.db.exec(`
create table opportunities(id uuid primary key,org_id uuid,stage text,status text,pursuit_state text,pursuit_reason text,pursuit_version integer);
create table subcontractors(id uuid primary key,org_id uuid,email text,email_verified boolean);
create table contracts(id uuid primary key,opportunity_id uuid,status text,primary_sub_id uuid,backup_sub_id uuid);
create table communications(id uuid primary key default gen_random_uuid(),org_id uuid,subcontractor_id uuid,opportunity_id uuid,
 channel text,direction text,subject text,body text,recipient_email text,gmail_thread_id text,gmail_message_id text,
 rfc822_message_id text,tracking_id uuid,delivery_state text,request_key uuid,request_fingerprint text,meta jsonb,
 sender_email text,provider text,delivery_detail text,provider_attempted_at timestamptz,provider_accepted_at timestamptz,
 delivery_updated_at timestamptz,created_at timestamptz default now(),follow_up_at timestamptz);
create unique index communications_request_key_unique on communications(org_id,request_key) where request_key is not null;`);},60000);
afterAll(async()=>{await state.db?.close();});
beforeEach(async()=>{state.paused=state.suppressed=state.stopped=state.support=false;vi.mocked(gmail.send).mockClear();
 const org=randomUUID(),opp=randomUUID(),sub=randomUUID(),contract=randomUUID();
 await state.db!.query("insert into opportunities values($1,$2,'won','open','active',null,1)",[opp,org]);
 await state.db!.query("insert into subcontractors values($1,$2,'sub@example.test',true)",[sub,org]);
 await state.db!.query("insert into contracts values($1,$2,'active',$3,null)",[contract,opp,sub]);
 params={orgId:org,opportunityId:opp,subcontractorId:sub,postAwardCompliance:{contractId:contract},to:"sub@example.test",
 subject:"Your paperwork",text:"Please provide your insurance documents.",html:"<p>Please provide your insurance documents.</p>",
 scheduled:{key:randomUUID(),meta:{kind:"compliance-chase"}}};
});
describe("post-award transactional transport",()=>{
 it("sends awarded paperwork once through real gates and durable receipt handling",async()=>{
  expect(await sendOutreachEmail(params)).toMatchObject({provider:"gmail",messageId:"receipt"});
  expect(await sendOutreachEmail(params)).toMatchObject({replayed:true});expect(gmail.send).toHaveBeenCalledTimes(1);
 });
 it("keeps ordinary outreach closed on won work",async()=>{
  expect(await sendOutreachEmail({...params,postAwardCompliance:undefined})).toMatchObject({provider:null,disabled:true});expect(gmail.send).not.toHaveBeenCalled();
 });
 it.each(["paused","suppressed","stopped","support"] as const)("retains %s protection",async flag=>{
  state[flag]=true;expect((await sendOutreachEmail(params)).provider).toBeNull();expect(gmail.send).not.toHaveBeenCalled();
 });
 it.each(["paused","aborted"])("holds a %s award pursuit",async pursuit=>{
  await state.db!.query("update opportunities set pursuit_state=$2 where id=$1",[params.opportunityId,pursuit]);
  expect((await sendOutreachEmail(params)).provider).toBeNull();expect(gmail.send).not.toHaveBeenCalled();
 });
 it("requires tenant, named active contract, verified exact recipient and matching generation",async()=>{
  for(const overrides of [{orgId:randomUUID()},{subcontractorId:randomUUID()},{to:"other@example.test"},{postAwardCompliance:{contractId:randomUUID()}}])
   expect((await sendOutreachEmail({...params,...overrides})).provider).toBeNull();
  expect((await runWithPursuitVersion({opportunityId:params.opportunityId!,version:2},()=>sendOutreachEmail(params))).provider).toBeNull();
  await state.db!.query("update contracts set status='closed' where id=$1",[params.postAwardCompliance!.contractId]);
  expect((await sendOutreachEmail(params)).provider).toBeNull();expect(gmail.send).not.toHaveBeenCalled();
 });
});
