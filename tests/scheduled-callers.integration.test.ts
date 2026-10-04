import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {randomUUID} from "node:crypto";
const state=vi.hoisted(()=>({db:null as PGlite|null,paused:false,suppressed:false,stopped:false,support:false}));
vi.mock("../lib/db",()=>({query:async(sql:string,p:unknown[]=[]) => (await state.db!.query(sql,p)).rows,queryOne:async(sql:string,p:unknown[]=[]) => (await state.db!.query(sql,p)).rows[0]??null}));
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
vi.mock("../lib/logger",()=>({logAgent:async()=>undefined}));
vi.mock("../lib/ai/companyProfile",()=>({getProfileJson:async()=>({legal_name:"Prime",owner_name:"Pat"})}));
import {requestClarification} from "../lib/domain/reply-clarify";
import {closeOutDeclinedSub} from "../lib/domain/decline-closeout";
import {lastCallForOrg} from "../lib/agents/maintenance";
import {scheduledRequestKey} from "../lib/scheduled-email";
let params:OutreachSendParams;
beforeAll(async()=>{state.db=new PGlite();await state.db.exec(`
create table opportunities(id uuid primary key,org_id uuid,stage text,status text,pursuit_state text,pursuit_reason text,pursuit_version integer,title text,deadline timestamptz,human_action_required boolean);
create table subcontractors(id uuid primary key,org_id uuid,email text,email_verified boolean,owner_name text,company_name text);
create table contracts(id uuid primary key,opportunity_id uuid,status text,primary_sub_id uuid,backup_sub_id uuid);
create table opportunity_subs(id uuid default gen_random_uuid(),opportunity_id uuid,subcontractor_id uuid,trade text,removed_at timestamptz,outreach_state text,responded_at timestamptz);
create table call_cards(opportunity_id uuid,subcontractor_id uuid,org_id uuid,status text,response_json jsonb);
create table quotes(opportunity_id uuid,trade text,quote_amount numeric);
create table communications(id uuid primary key default gen_random_uuid(),org_id uuid,subcontractor_id uuid,opportunity_id uuid,
 channel text,direction text,subject text,body text,recipient_email text,gmail_thread_id text,gmail_message_id text,
 rfc822_message_id text,tracking_id uuid,delivery_state text,request_key uuid,request_fingerprint text,meta jsonb,
 sender_email text,provider text,delivery_detail text,provider_attempted_at timestamptz,provider_accepted_at timestamptz,
 delivery_updated_at timestamptz,created_at timestamptz default now(),follow_up_at timestamptz);
create unique index communications_request_key_unique on communications(org_id,request_key) where request_key is not null;`);},60000);
afterAll(async()=>{await state.db?.close();});
beforeEach(async()=>{state.paused=state.suppressed=state.stopped=state.support=false;vi.mocked(gmail.send).mockClear();
 const org=randomUUID(),opp=randomUUID(),sub=randomUUID(),contract=randomUUID();
 await state.db!.query("insert into opportunities values($1,$2,'outreach','open','active',null,1,'Job',now()+interval '2 days',false)",[opp,org]);
 await state.db!.query("insert into subcontractors values($1,$2,'sub@example.test',true,'Builder','Sub Co')",[sub,org]);
 await state.db!.query("insert into contracts values($1,$2,'active',$3,null)",[contract,opp,sub]);
 await state.db!.query("insert into opportunity_subs(opportunity_id,subcontractor_id,trade,outreach_state) values($1,$2,'HVAC','followed_up')",[opp,sub]);
 params={orgId:org,opportunityId:opp,subcontractorId:sub,postAwardCompliance:{contractId:contract},to:"sub@example.test",
 subject:"Your paperwork",text:"Please provide your insurance documents.",html:"<p>Please provide your insurance documents.</p>",
 scheduled:{key:randomUUID(),meta:{kind:"compliance-chase"}}};
});

describe("scheduled caller recovery",()=>{
 for(const kind of ["clarification","decline_thank_you","final_nudge"]){
  it.each(["held","failed","unknown","sent"])(`${kind} handles a prior %s receipt through the actual caller`,async status=>{
   const key=JSON.stringify(kind!=="decline_thank_you"?[kind,params.opportunityId,params.subcontractorId]:[kind,params.opportunityId,params.subcontractorId,"HVAC"]);
   await state.db!.query(`insert into communications(org_id,opportunity_id,subcontractor_id,direction,channel,meta,request_key,delivery_state,gmail_message_id)
    values($1,$2,$3,'outbound','email',$4::jsonb,$5,$6,$7)`,[params.orgId,params.opportunityId,params.subcontractorId,JSON.stringify({kind,trade:"HVAC"}),scheduledRequestKey(key),status,status==="sent"?"old-receipt":null]);
   const invoke=()=>kind==="clarification"?requestClarification({orgId:params.orgId!,opportunityId:params.opportunityId!,subcontractorId:params.subcontractorId!,trade:"HVAC",toEmail:params.to,companyName:"Sub Co",opportunityTitle:"Job",gaps:["price"],outcome:"interested"})
    :kind==="decline_thank_you"?closeOutDeclinedSub({orgId:params.orgId!,opportunityId:params.opportunityId!,subcontractorId:params.subcontractorId!,trade:"HVAC",source:"email_reply",sendThankYou:true})
    :lastCallForOrg(params.orgId!);
   await invoke();await invoke();
   expect(gmail.send).toHaveBeenCalledTimes(["held","failed"].includes(status)?1:0);
   const rows=await state.db!.query("select delivery_state from communications where org_id=$1 and meta->>'kind'=$2",[params.orgId,kind]);
   expect(rows.rows).toHaveLength(1);expect(rows.rows[0].delivery_state).toBe(status==="unknown"?"unknown":"sent");
  });
 }
});
