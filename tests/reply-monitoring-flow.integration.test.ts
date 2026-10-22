import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {randomUUID} from "node:crypto";
const state=vi.hoisted(()=>({db:null as PGlite|null,attempts:[] as unknown[],logs:[] as unknown[],threadClear:true,paused:false,beforeSend:null as null|(()=>Promise<void>)}));
vi.mock("../lib/db",()=>({
  query:async(sql:string,args:unknown[]=[]) => (await state.db!.query(sql,args)).rows,
  queryOne:async(sql:string,args:unknown[]=[]) => (await state.db!.query(sql,args)).rows[0] ?? null,
}));
vi.mock("../lib/reply-processing-lock",()=>({assertReplyProcessingOwnership:async()=>{},withReplyProcessingLock:async(_o:string,_m:string,f:()=>Promise<unknown>)=>f()}));
vi.mock("../lib/auth",()=>({currentUser:async()=>null}));
vi.mock("../lib/logger",()=>({logAgent:async(x:unknown)=>{state.logs.push(x);}}));
vi.mock("../lib/queue",()=>({enqueue:vi.fn(async()=>"job")}));
vi.mock("../lib/ai/claude",()=>({claudeEnabled:async()=>false,completeJson:()=>{throw Error("No paid inference permitted in fixture");}}));
vi.mock("../lib/ai/companyProfile",()=>({getProfileJson:async()=>({legal_name:"Synthetic Prime",owner_name:"Alex"})}));
vi.mock("../lib/app-settings",()=>({getAutomationRules:async()=>({rfq_outbound_enabled:!state.paused,followup_max:0}),isAutomationStopped:async()=>state.paused,AUTOMATION_PAUSED_ERROR:"Automation paused"}));
vi.mock("../lib/billing/trial-limits",()=>({checkTrialQuota:async()=>({allowed:true})}));
vi.mock("../lib/work-mode",()=>({opportunityOutreachAllowed:async()=>true}));
vi.mock("../lib/pursuit-guard",()=>({pursuitStatus:async()=>({mayAct:true})}));
vi.mock("../lib/domain/sender-identity",()=>({resolveOutreachSender:async()=>({connected:true,from:"prime@example.test",replyTo:"prime@example.test"})}));
vi.mock("../lib/integrations/gmail",()=>({gmail:{isConnected:async()=>true,
  declineThreadUnchanged:async()=>state.threadClear,
  send:async(p:Record<string,any>)=>{
    await state.beforeSend?.();
    try {await p.beforeProviderSend?.("prime@example.test");}
    catch(e){return {error:String(e),outcome:"not_attempted"};}
    state.attempts.push(p);return {messageId:randomUUID(),threadId:p.threadId ?? "synthetic-thread",outcome:"accepted"};
  }}}));
import {applyOutcomeToSolicitation} from "../lib/domain/reply-outcome";
import {recordBounce} from "../lib/agents/maintenance";
import {parseBounce} from "../lib/domain/email-delivery";
import {captureReply} from "../lib/reply-capture";
import {sendOutreachEmail} from "../lib/integrations/email-transport";
import {isSuppressed,suppressEmail} from "../lib/domain/email-suppression";
const q=async<T=Record<string,any>>(sql:string,args:unknown[]=[]) => (await state.db!.query<T>(sql,args)).rows;
beforeAll(async()=>{state.db=new PGlite();await state.db.exec(`
 create table unmatched_inbound(id uuid,org_id uuid,state text,matched_by text);
 create table opportunities(id uuid primary key,org_id uuid,title text);
 create table subcontractors(id uuid primary key,org_id uuid,email text,company_name text,owner_name text,notes text,email_verified boolean default true);
 create table opportunity_subs(id uuid default gen_random_uuid(),opportunity_id uuid,subcontractor_id uuid,trade text,removed_at timestamptz,outreach_state text,responded_at timestamptz);
 create table call_cards(opportunity_id uuid,subcontractor_id uuid,org_id uuid,status text,response_json jsonb);
 create table communications(id uuid primary key default gen_random_uuid(),org_id uuid,subcontractor_id uuid,opportunity_id uuid,channel text,direction text,subject text,body text,
 gmail_thread_id text,gmail_message_id text,rfc822_message_id text,recipient_email text,replied_at timestamptz,meta jsonb default '{}',created_at timestamptz default now(),
 tracking_id uuid,delivery_state text,request_key uuid,request_fingerprint text,sender_email text,provider_attempted_at timestamptz,provider_accepted_at timestamptz,
 delivery_updated_at timestamptz,delivery_detail text,provider text,follow_up_at timestamptz);
 create unique index inbound_unique on communications(org_id,gmail_message_id) where direction='inbound' and gmail_message_id is not null and org_id is not null;
 create unique index intent_unique on communications(org_id,request_key) where request_key is not null;
 create table email_suppressions(id uuid default gen_random_uuid(),org_id uuid,email text,reason text,source text,created_at timestamptz default now());
 create unique index email_stop on email_suppressions(org_id,lower(email));
 create table outreach_suppressions(id uuid,org_id uuid,subcontractor_id uuid,opportunity_id uuid,trade text,channel text,reason text,note text,actor text,created_at timestamptz,lifted_at timestamptz,lifted_by text);
 create table subcontractor_reply_events(org_id uuid,subcontractor_id uuid,opportunity_id uuid,trade text,intent text,reason text,original_message text,gmail_message_id text,gmail_thread_id text,extracted jsonb,confidence numeric,needs_review boolean,review_reason text);
 create unique index reply_event_unique on subcontractor_reply_events(org_id,gmail_message_id) where gmail_message_id is not null and org_id is not null;
 `);},60000);
afterAll(async()=>{await state.db?.close();});
beforeEach(()=>{state.attempts=[];state.logs=[];state.threadClear=true;state.paused=false;state.beforeSend=null;});
async function fixture(){
 const org=randomUUID(),opp=randomUUID(),sub=randomUUID(),out=randomUUID();
 await q("insert into opportunities values($1,$2,'Synthetic scope')",[opp,org]);
 await q("insert into subcontractors(id,org_id,email,company_name,owner_name,notes) values($1,$2,'supplier@example.test','Synthetic Firm','Sam',null)",[sub,org]);
 await q("insert into opportunity_subs(opportunity_id,subcontractor_id,trade,outreach_state) values($1,$2,'Hydro Jetting','sent'),($1,$2,'Electrical','sent')",[opp,sub]);
 await q("insert into communications(id,org_id,subcontractor_id,opportunity_id,direction,channel,recipient_email,delivery_state,follow_up_at,meta) values($1,$2,$3,$4,'outbound','email','supplier@example.test','sent',now(),'{\"trade\":\"Hydro Jetting\",\"kind\":\"outreach\"}')",[out,org,sub,opp]);
 const input={orgId:org,comm:{id:out,subcontractor_id:sub,opportunity_id:opp,company_name:"Synthetic Firm",sub_email:"supplier@example.test",opportunity_title:"Synthetic scope",trade:"Hydro Jetting"},
  strongMatch:true,fromEmail:"supplier@example.test",fromAddress:"Sam <supplier@example.test>",replyText:"Thank you for considering us but we are not interested.",
  messageId:randomUUID(),threadId:"fixture-thread",rfc822MessageId:"<fixture-reply@example.test>",subject:"Re: Pricing request",sentAt:"2026-10-22T04:04:59Z"};
 const send={orgId:org,opportunityId:opp,subcontractorId:sub,trade:"Hydro Jetting",to:"supplier@example.test",subject:"Pricing request",text:"Please quote the complete scope for this project.",html:"<p>Please quote the complete scope for this project.</p>"};
 return {org,opp,sub,out,input,send};
}
describe("synthetic reply through capture, history, closeout and actual transport gates",()=>{
 it("saves an unmatched DSN once without suppressing an unverified address",async()=>{
  const org=randomUUID(),id=randomUUID(),body="Final-Recipient: rfc822; unknown@example.test\nAction: failed\nStatus: 5.1.1";
  const input={orgId:org,messageId:id,threadId:"unknown-thread",body,report:parseBounce(body)};
  expect(await recordBounce(input)).toBe(false);await recordBounce(input);
  expect(await q("select * from communications where org_id=$1 and gmail_message_id=$2",[org,id])).toHaveLength(1);
  expect(await isSuppressed(org,"unknown@example.test")).toBe(false);expect(state.logs).toHaveLength(1);
 });
 it("does not reopen a closed request from a later interested reply or direct outcome",async()=>{
  const f=await fixture();await captureReply(f.input);
  const r=await captureReply({...f.input,messageId:randomUUID(),replyText:"We would now like to quote.",
    extract:async()=>({intent:"interested",isQuote:false,quoteAmount:null,scopeSummary:null,canPerform:true,capabilityNotes:null,
      notes:null,confidence:1,method:"ai",conflicts:[],tradesMentioned:[],missingFields:[]} as any)});
  expect(r.decision).toMatchObject({act:false,needsReview:true});
  expect(await applyOutcomeToSolicitation({opportunityId:f.opp,subcontractorId:f.sub,trade:"Hydro Jetting",outcome:"interested"})).toMatchObject({applied:false,refused:"closed_or_missing_request"});
  expect((await q("select outreach_state from opportunity_subs where opportunity_id=$1 and trade='Hydro Jetting'",[f.opp]))[0].outreach_state).toBe("declined");
  expect(state.attempts).toHaveLength(1);
 });
 it("blocks a legacy uncertain held send and a decline arriving immediately before dispatch",async()=>{
  const f=await fixture();
  await q("insert into communications(org_id,direction,recipient_email,delivery_state,meta) values($1,'outbound','supplier@example.test','held','{\"reconciled\":\"gmail_not_found\"}')",[f.org]);
  expect(await sendOutreachEmail(f.send)).toMatchObject({blocked:true});
  const g=await fixture();state.beforeSend=async()=>{await q("update opportunity_subs set outreach_state='declined' where opportunity_id=$1 and trade='Hydro Jetting'",[g.opp]);};
  expect(await sendOutreachEmail(g.send)).toMatchObject({blocked:true,outcome:"not_attempted"});expect(state.attempts).toHaveLength(0);
 });

 it.each(["5.1.1","5.4.1","5.2.2"])("deduplicates a failed %s DSN and preserves its exact cause",async(status)=>{
  const f=await fixture(),id=randomUUID();
  const diagnostic=status==="5.1.1"?"550 Account does not exist":status==="5.4.1"?"550 Recipient address rejected: Access denied":"552 Inbox out of storage and inactive";
  const body=`Final-Recipient: rfc822; supplier@example.test\nAction: failed\nStatus: ${status}\nDiagnostic-Code: smtp; ${diagnostic}`;
  const input={orgId:f.org,messageId:id,threadId:"dsn-thread",report:parseBounce(body),body,sentAt:"2026-10-22T02:17:30Z"};
  await recordBounce(input);await recordBounce(input);
  expect(await q("select * from communications where org_id=$1 and gmail_message_id=$2",[f.org,id])).toHaveLength(1);
  expect(await isSuppressed(f.org,"supplier@example.test")).toBe(true);
  expect((await q("select delivery_state,delivery_detail from communications where id=$1",[f.out]))[0]).toMatchObject({delivery_state:"bounced",delivery_detail:diagnostic});
  expect(state.logs).toHaveLength(1);
  expect((await q("select follow_up_at from communications where id=$1",[f.out]))[0].follow_up_at).toBeNull();
  expect(await sendOutreachEmail(f.send)).toMatchObject({blocked:true});expect(state.attempts).toHaveLength(0);
 });

 it("logs a decline, cancels its schedule, blocks queued follow-up and acknowledges once",async()=>{
  const f=await fixture();const extract=vi.fn(async()=>{throw Error("must not call AI");});
  const result=await captureReply({...f.input,extract});
  expect(result,JSON.stringify({logs:state.logs,rows:await q("select direction,delivery_state,delivery_detail,meta from communications where org_id=$1",[f.org])})).toMatchObject({declined:true,thankYouSent:true});expect(extract).not.toHaveBeenCalled();
  expect((await q("select outreach_state from opportunity_subs where opportunity_id=$1 order by trade",[f.opp])).map(x=>x.outreach_state)).toEqual(["sent","declined"]);
  expect((await q("select follow_up_at from communications where id=$1",[f.out]))[0].follow_up_at).toBeNull();
  expect(await q("select * from subcontractor_reply_events where org_id=$1",[f.org])).toHaveLength(1);
  expect(await sendOutreachEmail(f.send)).toMatchObject({blocked:true});
  expect((await captureReply(f.input)).duplicate).toBe(true);expect(state.attempts).toHaveLength(1);
  expect((state.attempts[0] as any).text).toContain("will not follow up on it");
  expect((state.attempts[0] as any).text).not.toContain("future fits");
 });
 it("holds a departed address across trades without contacting a replacement",async()=>{
  const f=await fixture();const r=await captureReply({...f.input,subject:"Automatic reply",autoSubmitted:"auto-generated",
    replyText:"Joe is no longer working at Example Construction. Contact Pat at pat@example.test."});
  expect(r).toMatchObject({noticeKind:"departed",contactHeld:true,thankYouSent:false});
  expect(await isSuppressed(f.org,"supplier@example.test")).toBe(true);
  expect(await isSuppressed(randomUUID(),"supplier@example.test")).toBe(false);
  expect(await isSuppressed(f.org,"pat@example.test")).toBe(false);
  expect(await sendOutreachEmail({...f.send,trade:"Electrical"})).toMatchObject({blocked:true});
  expect(state.attempts).toHaveLength(0);
 });
 it("records ordinary absence without decisions, coverage or mail",async()=>{
  const f=await fixture();const r=await captureReply({...f.input,subject:"Automatic reply",replyText:"I am out of the office Thursday and will respond upon my return."});
  expect(r).toMatchObject({noticeKind:"away",decision:{needsReview:false,act:false}});
  expect((await q("select outreach_state from opportunity_subs where opportunity_id=$1",[f.opp])).every(x=>x.outreach_state==="sent")).toBe(true);
  expect(state.attempts).toHaveLength(0);
 });
 it("honors an explicit opt-out globally within the tenant, with no acknowledgment",async()=>{
  const f=await fixture();expect(await captureReply({...f.input,replyText:"Not interested. Stop emailing me."})).toMatchObject({noticeKind:"opt_out",contactHeld:true});
  expect(await isSuppressed(f.org,f.input.fromEmail)).toBe(true);expect(state.attempts).toHaveLength(0);
 });
 it("does not hold an address on a weakly matched departure",async()=>{
  const f=await fixture();const r=await captureReply({...f.input,strongMatch:false,subject:"Automatic reply",replyText:"Joe is no longer working at Example."});
  expect(r.contactHeld).toBe(false);expect(await isSuppressed(f.org,f.input.fromEmail)).toBe(false);
 });
 it("persists the envelope when interpretation fails and resumes the same incoming row",async()=>{
  const f=await fixture();const input={...f.input,replyText:"Could you clarify section three?",extract:vi.fn(async()=>{throw Error("inference unavailable");})};
  await expect(captureReply(input)).rejects.toThrow("inference unavailable");
  expect(await q("select * from communications where direction='inbound' and org_id=$1",[f.org])).toHaveLength(1);
  await expect(captureReply(input)).rejects.toThrow("inference unavailable");
  expect(await q("select * from communications where direction='inbound' and org_id=$1",[f.org])).toHaveLength(1);
 });
 it.each(["thread_changed","uncertain","paused"])("closes a decline but withholds acknowledgment for %s",async(reason)=>{
  const f=await fixture();state.threadClear=reason!=="thread_changed";state.paused=reason==="paused";
  if(reason==="uncertain")await q("insert into communications(org_id,direction,recipient_email,delivery_state) values($1,'outbound','supplier@example.test','unknown')",[f.org]);
  const r=await captureReply(f.input);expect(r.declined).toBe(true);expect(r.thankYouSent).toBe(false);expect(state.attempts).toHaveLength(0);
 });
 it("rechecks a hold arriving after composition, before any provider attempt",async()=>{
  const f=await fixture();state.beforeSend=()=>suppressEmail({orgId:f.org,email:f.send.to,source:"reply",reason:"Contact departed"});
  expect(await sendOutreachEmail(f.send)).toMatchObject({blocked:true,outcome:"not_attempted"});expect(state.attempts).toHaveLength(0);
 });
});
