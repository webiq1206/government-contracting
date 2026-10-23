import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {randomUUID} from "node:crypto";
const s=vi.hoisted(()=>({paused:true,platform:false,mailbox:"owner@synthetic.test",aliasAllowed:true,pages:[] as any[],threads:{} as Record<string,any[]>,beforeFetch:null as null|(()=>Promise<void>),onCapture:null as null|(()=>Promise<void>),reads:vi.fn(),sent:vi.fn(),ai:vi.fn()}));
vi.mock("../lib/reply-capture",async importOriginal=>{
 const original=await importOriginal<typeof import("../lib/reply-capture")>();
 return {...original,captureReply:async(...args:Parameters<typeof original.captureReply>)=>{await s.onCapture?.();return original.captureReply(...args);}};
});
vi.mock("../lib/integrations/gmail",()=>({gmail:{mailboxIdentity:async()=>({ok:true,email:s.mailbox}),
 sendAsAddresses:async()=>s.aliasAllowed?{ok:true,options:[{address:"quotes@synthetic.test"},{address:"owner@synthetic.test"}]}:{ok:false,error:"Existing grant denied alias read"},
 fetchSentMailbox:async(...args:unknown[])=>{s.reads(...args);await s.beforeFetch?.();return s.pages.shift() ?? {messages:[]};},
 readMailboxThread:async(id:string)=>({messages:s.threads[id] ?? []}),
 send:s.sent,isConnected:async()=>true,declineThreadUnchanged:async()=>true}}));
vi.mock("../lib/app-settings",()=>({isAutomationPaused:async()=>s.paused,isAutomationStopped:async()=>s.paused,isPlatformAutomationPaused:async()=>s.platform,
 AUTOMATION_PAUSED_ERROR:"Paused",getAutomationRules:async()=>({rfq_outbound_enabled:true,followup_max:0})}));
vi.mock("../lib/ai/claude",()=>({completeJson:s.ai,claudeEnabled:async()=>false}));
vi.mock("../lib/ai/companyProfile",()=>({getProfileJson:async()=>({legal_name:"Synthetic Prime",owner_name:"Sam"})}));
import {query,queryOne,standaloneClient} from "../lib/db";
import {runWithOrg} from "../lib/tenant-context";
import {importMailboxSent,reconcileMailboxForOrg,mailboxSourceAt} from "../lib/mailbox-reconcile";
import {subConversations} from "../lib/domain/conversation";
import {conversationList} from "../lib/conversations";
import {replySendBlock} from "../lib/outreach-eligibility";
import {captureReply} from "../lib/reply-capture";
import {sendScheduledEmail,scheduledRequestKey} from "../lib/scheduled-email";
import type {GmailMailboxMessage} from "../lib/integrations/gmail";
const d=process.env.DATABASE_URL?describe:describe.skip;
const now=new Date("2026-10-23T12:00:00Z"),before=new Date(now.getTime()-7200000).toISOString(),sentAt=new Date(now.getTime()-3600000).toISOString();
const ids:string[]=[];
async function fixture(){
 const org=(await queryOne<{id:string}>("insert into organizations(name,subscription_status,billing_exempt) values('Synthetic mailbox sync','active',true) returning id"))!.id;ids.push(org);
 const generation=randomUUID();
 await query(`insert into integration_tokens(org_id,provider,email,send_as,status,connection_generation,data)
  values($1,'gmail','owner@synthetic.test','quotes@synthetic.test','connected',$2,'{}')`,[org,generation]);
 const opp=(await queryOne<{id:string}>("insert into opportunities(org_id,source,title,status) values($1,'test','Synthetic scope','open') returning id",[org]))!.id;
 const sub=(await queryOne<{id:string}>("insert into subcontractors(org_id,company_name,email,email_verified) values($1,'Synthetic supplier','supplier@synthetic.test',true) returning id",[org]))!.id;
 await query("insert into opportunity_subs(opportunity_id,subcontractor_id,trade,outreach_state) values($1,$2,'Electrical','sent')",[opp,sub]);
 const thread="synthetic-"+randomUUID();
 await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,subject,body,gmail_thread_id,gmail_message_id,rfc822_message_id,recipient_email,created_at,follow_up_at,provider,delivery_state,meta)
  values($1,$2,$3,'email','outbound','Synthetic invitation','Please review this synthetic scope.',$4,$5,'<original@synthetic.test>','supplier@synthetic.test',$6,now(),'gmail','sent','{"trade":"Electrical","kind":"outreach"}')`,[org,opp,sub,thread,randomUUID(),new Date(now.getTime()-10800000).toISOString()]);
 const incoming="incoming-"+randomUUID();
 await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,subject,body,gmail_thread_id,gmail_message_id,rfc822_message_id,recipient_email,created_at,meta)
  values($1,$2,$3,'email','inbound','Re: Synthetic invitation','Please clarify a project detail.',$4,$5,'<incoming@synthetic.test>','supplier@synthetic.test',$6,'{"trade":"Electrical","reply_processing_complete":true}')`,[org,opp,sub,thread,incoming,before]);
 const message:GmailMailboxMessage={messageId:"sent-"+randomUUID(),threadId:thread,from:"Synthetic Prime <quotes@synthetic.test>",to:"Supplier <supplier@synthetic.test>",cc:"",date:sentAt,
  subject:"Re: Synthetic invitation",contentType:"text/plain",rfc822MessageId:"<sent@synthetic.test>",inReplyTo:"<incoming@synthetic.test>",references:["<incoming@synthetic.test>"],snippet:"Synthetic response.",body:"Synthetic response. We will review the missing details.",attachments:[],labels:["SENT"],internalDate:String(Date.parse(sentAt))};
 return {org,opp,sub,thread,generation,message,incoming};
}
beforeEach(()=>{s.paused=true;s.platform=false;s.mailbox="owner@synthetic.test";s.aliasAllowed=true;s.pages=[];s.threads={};s.beforeFetch=null;s.onCapture=null;vi.clearAllMocks();s.ai.mockImplementation(()=>{throw Error("Paid AI is forbidden in mailbox observation fixtures");});s.sent.mockImplementation(()=>{throw Error("No sending allowed in mailbox observation fixtures");});});
afterAll(async()=>{for(const org of ids){for(const table of ["agent_logs","job_runs","communications","subcontractor_reply_events","outreach_suppressions","email_suppressions","call_cards","opportunity_subs","integration_tokens","opportunities","subcontractors"])
 await query(`delete from ${table} where org_id=$1`,[org]).catch(()=>{});await query("delete from organizations where id=$1",[org]).catch(()=>{});}});
d("observed Gmail replies become accurate, idempotent platform history",()=>{
 it("imports a real Sent-shaped reply, cancels the old follow-up, and preserves an unresolved commercial review",async()=>{
  const f=await fixture();await query(`insert into subcontractor_reply_events(org_id,opportunity_id,subcontractor_id,trade,intent,original_message,gmail_message_id,gmail_thread_id,needs_review)
   values($1,$2,$3,'Electrical','other','Synthetic terms require review',$4,$5,true)`,[f.org,f.opp,f.sub,f.incoming,f.thread]);
  expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,["quotes@synthetic.test"],f.message,now))).toBe("imported");
  const rows=await query<{direction:string;follow_up_at:string|null}>("select direction,follow_up_at from communications where org_id=$1 order by created_at",[f.org]);
  expect(rows.map(r=>r.direction)).toEqual(["outbound","inbound","outbound"]);expect(rows.filter(r=>r.follow_up_at)).toHaveLength(0);
  const [conv]=await subConversations(f.sub,f.org);expect(conv.awaitingUs).toBe(false);expect(conv.messages).toHaveLength(3);
  const summaries=await runWithOrg(f.org,()=>conversationList());expect(summaries[0].state).toBe("needs_review");
  expect((await queryOne<{reviewed_at:string|null}>("select reviewed_at from subcontractor_reply_events where org_id=$1",[f.org]))!.reviewed_at).toBeNull();
  expect(s.sent).not.toHaveBeenCalled();expect(s.ai).not.toHaveBeenCalled();
 });
 it("serializes duplicate imports and never manufactures a receipt beside an uncertain intent",async()=>{
  const f=await fixture();const results=await Promise.all([1,2,3].map(()=>runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",f.message,now))));
  expect(results.sort()).toEqual(["duplicate","duplicate","imported"]);
  expect((await query("select id from communications where org_id=$1 and gmail_message_id=$2",[f.org,f.message.messageId]))).toHaveLength(1);
  const g=await fixture();await query(`insert into communications(org_id,channel,direction,recipient_email,delivery_state) values($1,'email','outbound','supplier@synthetic.test','unknown')`,[g.org]);
  expect(await runWithOrg(g.org,()=>importMailboxSent(g.org,g.generation,"quotes@synthetic.test",g.message,now))).toBe("held");
  expect((await query("select id from communications where org_id=$1 and gmail_message_id=$2",[g.org,g.message.messageId]))).toHaveLength(0);
 });
 it("does not cross tenant, alias, recipient or ambiguous thread boundaries",async()=>{
  const f=await fixture(),g=await fixture();
  expect(await runWithOrg(g.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",f.message,now))).toBe("held");
  expect(await runWithOrg(g.org,()=>importMailboxSent(g.org,g.generation,"quotes@synthetic.test",f.message,now))).toBe("unmatched");
  for(const change of [{from:"unverified@synthetic.test"},{to:"stranger@synthetic.test"},{labels:["DRAFT"]}])
   expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",{...f.message,...change},now))).toBe("held");
  await query("update communications set meta='{"+'"trade":"Plumbing"'+"}'::jsonb where org_id=$1 and direction='inbound'",[f.org]);
  await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,gmail_thread_id,meta) values($1,$2,$3,'email','outbound',$4,'{"trade":"Plumbing"}')`,[f.org,f.opp,f.sub,f.thread]);
  expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",f.message,now))).toBe("held");
 });
 it("checks mailbox identity and existing alias permission before scanning, and stops on a changed connection",async()=>{
  const f=await fixture();s.mailbox="different@synthetic.test";
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(false);expect(s.reads).not.toHaveBeenCalled();
  s.mailbox="owner@synthetic.test";s.aliasAllowed=false;expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(false);expect(s.reads).not.toHaveBeenCalled();
  s.aliasAllowed=true;s.pages=[{messages:[f.message]}];s.beforeFetch=async()=>{await query("update integration_tokens set connection_generation=$2 where org_id=$1",[f.org,randomUUID()]);};
  await expect(reconcileMailboxForOrg(f.org,now)).rejects.toThrow(/connection changed/i);
  expect(await query("select id from communications where org_id=$1 and gmail_message_id=$2",[f.org,f.message.messageId])).toHaveLength(0);
 });
 it("checkpoints pagination and overlap only after receipts commit, and deduplicates replayed pages",async()=>{
  const f=await fixture(),second={...f.message,messageId:"sent-second-"+randomUUID()};
  s.pages=[{messages:[f.message],nextPageToken:"page-two"},{messages:[second]},{messages:[f.message,second]}];
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(true);
  const first=(await queryOne<{data:Record<string,string>}>("select data from integration_tokens where org_id=$1",[f.org]))!.data;
  expect(first.mailbox_sync_page).toBe("page-two");
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(true);
  expect(s.reads.mock.calls[1][3]).toBe("page-two");
  const last=(await queryOne<{data:Record<string,string>}>("select data from integration_tokens where org_id=$1",[f.org]))!.data;
  expect(last.mailbox_sync_page).toBeNull();expect(Number(last.mailbox_sync_after)).toBe(Math.floor(now.getTime()/1000)-300);
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(true);
  expect(await query("select id from communications where org_id=$1 and meta->>'kind'='mailbox_sent'",[f.org])).toHaveLength(2);
 });
 it("preserves the cursor on a partial denied read without another route or replaying sends",async()=>{
  const f=await fixture();s.pages=[{messages:[f.message],error:"Existing connection denied"}];
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(false);
  expect((await queryOne<{data:Record<string,unknown>}>("select data from integration_tokens where org_id=$1",[f.org]))!.data.mailbox_sync_after).toBeUndefined();
  expect(s.reads).toHaveBeenCalledTimes(1);expect(s.sent).not.toHaveBeenCalled();
 });
 it("captures a later incoming message during account pause without treating it as understood or sending",async()=>{
  const f=await fixture();s.pages=[{messages:[f.message]}];
  const incoming={...f.message,messageId:"later-incoming-"+randomUUID(),labels:["INBOX"],from:"supplier@synthetic.test",to:"quotes@synthetic.test",internalDate:String(now.getTime()-600000),body:"Could you clarify the required verification?",rfc822MessageId:"<later@synthetic.test>"};
  s.threads[f.thread]=[f.message,incoming];
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(true);
  const [conv]=await subConversations(f.sub,f.org);expect(conv.awaitingUs).toBe(true);
  const row=(await queryOne<{meta:Record<string,unknown>}>("select meta from communications where org_id=$1 and gmail_message_id=$2",[f.org,incoming.messageId]))!;
  expect(row.meta.reply_processing_complete).toBe(false);
  expect(await runWithOrg(f.org,()=>replySendBlock({opportunityId:f.opp,subcontractorId:f.sub,trade:"Electrical",to:"supplier@synthetic.test",subject:"Fixture",html:"<p>Fixture</p>"},f.org))).toMatch(/incoming reply/);
  expect(s.ai).not.toHaveBeenCalled();expect(s.sent).not.toHaveBeenCalled();
 });
 it("applies a clear later decline during pause but never sends an acknowledgment",async()=>{
  const f=await fixture();s.pages=[{messages:[]}];s.threads[f.thread]=[{...f.message,messageId:"decline-"+randomUUID(),labels:["INBOX"],from:"supplier@synthetic.test",to:"quotes@synthetic.test",body:"We are not interested.",internalDate:String(now.getTime()-500000)}];
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(true);
  expect((await queryOne<{outreach_state:string}>("select outreach_state from opportunity_subs where opportunity_id=$1",[f.opp]))!.outreach_state).toBe("declined");
  expect(s.ai).not.toHaveBeenCalled();expect(s.sent).not.toHaveBeenCalled();
 });
 it("honors the platform pause before any mailbox read",async()=>{
  const f=await fixture();s.platform=true;
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(true);expect(s.reads).not.toHaveBeenCalled();
 });
 it("does not invent a send time from a Date header or ingestion clock",()=>{
  const m={internalDate:null} as GmailMailboxMessage;expect(mailboxSourceAt(m,now)).toBeNull();
  expect(mailboxSourceAt({...m,internalDate:String(now.getTime()+86400000)},now)).toBeNull();
 });
 it("does not confuse a quoted display-name address with the real recipient",async()=>{
  const f=await fixture();
  for(const to of ['"supplier@synthetic.test" <stranger@synthetic.test>', 'group: supplier@synthetic.test;', 'Supplier <supplier@synthetic.test'])
   expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",{...f.message,to},now))).toBe("held");
  expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",{...f.message,to:'"Supplier, Synthetic" <supplier@synthetic.test>, owner@synthetic.test'},now))).toBe("imported");
 });
 it("holds an existing provider id attributed to another request or an uncertain send",async()=>{
  const f=await fixture();
  const otherOpp=(await queryOne<{id:string}>("insert into opportunities(org_id,source,title,status) values($1,'test','Other synthetic scope','open') returning id",[f.org]))!.id;
  await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,gmail_message_id,gmail_thread_id,delivery_state)
   values($1,$2,$3,'email','outbound',$4,$5,'sent')`,[f.org,otherOpp,f.sub,f.message.messageId,"other-synthetic-thread"]);
  expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",f.message,now))).toBe("held");
  await query("delete from communications where org_id=$1 and gmail_message_id=$2",[f.org,f.message.messageId]);
  await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,gmail_message_id,gmail_thread_id,delivery_state)
   values($1,$2,$3,'email','outbound',$4,$5,'unknown')`,[f.org,f.opp,f.sub,f.message.messageId,f.thread]);
  expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",f.message,now))).toBe("held");
 });
 it("records delayed mail in provider order and does not overwrite a newer supplier outcome",async()=>{
  const f=await fixture();s.pages=[{messages:[f.message]}];
  s.threads[f.thread]=[{...f.message,messageId:"old-decline-"+randomUUID(),labels:["INBOX"],from:"supplier@synthetic.test",to:"quotes@synthetic.test",body:"We are not interested.",internalDate:String(Date.parse(before)-600000)}];
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(true);
  expect((await queryOne<{outreach_state:string}>("select outreach_state from opportunity_subs where opportunity_id=$1",[f.opp]))!.outreach_state).toBe("sent");
  const [conv]=await subConversations(f.sub,f.org);expect(conv.awaitingUs).toBe(false);expect(conv.messages.at(-1)?.gmail_message_id).toBe(f.message.messageId);
  const events=await query<{needs_review:boolean}>("select needs_review from subcontractor_reply_events where org_id=$1",[f.org]);expect(events).toHaveLength(1);expect(events[0].needs_review).toBe(true);
  expect((await runWithOrg(f.org,()=>conversationList()))[0].state).toBe("needs_review");
  expect(s.sent).not.toHaveBeenCalled();expect(s.ai).not.toHaveBeenCalled();
 });
 it("a reconnect waits through incoming capture, then prevents stale cursor writes",async()=>{
  const f=await fixture();s.threads[f.thread]=[{...f.message,messageId:"locked-decline-"+randomUUID(),labels:["INBOX"],from:"supplier@synthetic.test",to:"quotes@synthetic.test",body:"We are not interested.",internalDate:String(now.getTime()-500000)}];
  const replacement=standaloneClient({queryTimeoutMs:5000,applicationName:"synthetic-mailbox-reconnect"});await replacement.connect();
  let changed:Promise<unknown>|undefined;
  s.onCapture=async()=>{
   changed=replacement.query("update integration_tokens set connection_generation=$2 where org_id=$1",[f.org,randomUUID()]);
   let waiting=false;
   for(let i=0;i<100;i++){
    waiting=!!(await queryOne("select 1 from pg_stat_activity where application_name='synthetic-mailbox-reconnect' and wait_event_type='Lock'"));
    if(waiting)break;await new Promise(r=>setTimeout(r,5));
   }
   expect(waiting).toBe(true);
  };
  try {
   // Either the old cursor commits first or replacement wins immediately
   // after capture. Both serialize after the authorized incoming write.
   await reconcileMailboxForOrg(f.org,now).catch(e=>expect(String(e)).toMatch(/connection changed/i));
   await changed;
   expect((await queryOne<{outreach_state:string}>("select outreach_state from opportunity_subs where opportunity_id=$1",[f.opp]))!.outreach_state).toBe("declined");
   expect(await query("select id from communications where org_id=$1 and direction='inbound'",[f.org])).toHaveLength(2);
  }finally{await replacement.end();}
 });
 it("rotates known threads even when an uncertain Sent page is held",async()=>{
  const first=await fixture();
  // Eleven threads belonging to the same existing account.
  for(let i=0;i<10;i++)await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,gmail_thread_id,recipient_email,delivery_state,created_at,meta)
   values($1,$2,$3,'email','outbound',$4,'supplier@synthetic.test','sent',$5,'{"trade":"Electrical"}')`,[first.org,first.opp,first.sub,`zz-synthetic-${i.toString().padStart(2,"0")}`,before]);
  await query(`insert into communications(org_id,channel,direction,recipient_email,delivery_state) values($1,'email','outbound','supplier@synthetic.test','unknown')`,[first.org]);
  s.pages=[{messages:[first.message]},{messages:[first.message]}];
  expect((await reconcileMailboxForOrg(first.org,now)).ok).toBe(false);
  const cursor=(await queryOne<{data:Record<string,string>}>("select data from integration_tokens where org_id=$1",[first.org]))!.data;
  expect(cursor.mailbox_sync_after).toBeUndefined();expect(cursor.mailbox_sync_thread_after).toBe("zz-synthetic-08");
  s.threads["zz-synthetic-09"]=[{...first.message,threadId:"zz-synthetic-09",messageId:"later-tail-"+randomUUID(),labels:["INBOX"],from:"supplier@synthetic.test",to:"quotes@synthetic.test",internalDate:String(now.getTime()-600000),body:"Please clarify the responsible project party."}];
  expect((await reconcileMailboxForOrg(first.org,now)).ok).toBe(false);
  expect(await query("select id from communications where org_id=$1 and gmail_thread_id='zz-synthetic-09' and direction='inbound'",[first.org])).toHaveLength(1);
 });
 it("holds snippet-only evidence and never turns an unreadable body into a decline",async()=>{
  const f=await fixture();expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",{...f.message,bodyAvailable:false},now))).toBe("held");
  s.threads[f.thread]=[{...f.message,messageId:"snippet-"+randomUUID(),labels:["INBOX"],from:"supplier@synthetic.test",body:"We are not interested.",bodyAvailable:false}];
  expect((await reconcileMailboxForOrg(f.org,now)).ok).toBe(true);
  expect((await queryOne<{outreach_state:string}>("select outreach_state from opportunity_subs where opportunity_id=$1",[f.opp]))!.outreach_state).toBe("sent");
  expect((await runWithOrg(f.org,()=>conversationList()))[0].state).toBe("needs_review");
  const out=(await queryOne<{id:string}>("select id from communications where org_id=$1 and direction='outbound' limit 1",[f.org]))!;
  s.paused=false;
  const result=await runWithOrg(f.org,()=>captureReply({orgId:f.org,comm:{id:out.id,opportunity_id:f.opp,subcontractor_id:f.sub,trade:"Electrical",company_name:"Synthetic supplier",sub_email:"supplier@synthetic.test",opportunity_title:"Synthetic scope"},
   strongMatch:true,fromEmail:"supplier@synthetic.test",replyText:"We are not interested.",messageId:s.threads[f.thread][0].messageId,threadId:f.thread}));
  expect(result.decision.needsReview).toBe(true);expect(result.declined).toBe(false);
  expect(s.sent).not.toHaveBeenCalled();expect(s.ai).not.toHaveBeenCalled();
 });
 it("cancels a queued unattempted follow-up durably without mistaking it for an uncertain send",async()=>{
  const f=await fixture(),key="synthetic-old-chase-"+randomUUID();
  const old=(await queryOne<{id:string}>(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,recipient_email,
   gmail_thread_id,delivery_state,request_key,created_at,meta) values($1,$2,$3,'email','outbound','supplier@synthetic.test',$4,'queued',$5,$6,'{"trade":"Electrical","kind":"followup"}') returning id`,
   [f.org,f.opp,f.sub,f.thread,scheduledRequestKey(key),before]))!;
  const unrelated=(await queryOne<{id:string}>(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,recipient_email,
   gmail_thread_id,delivery_state,created_at,follow_up_at,meta) values($1,$2,$3,'email','outbound','supplier@synthetic.test',$4,'queued',$5,now(),'{"trade":"Electrical","kind":"compliance-chase"}') returning id`,
   [f.org,f.opp,f.sub,f.thread,before]))!;
  expect(await runWithOrg(f.org,()=>importMailboxSent(f.org,f.generation,"quotes@synthetic.test",f.message,now))).toBe("imported");
  const stopped=(await queryOne<{delivery_state:string;meta:Record<string,unknown>}>("select delivery_state,meta from communications where id=$1",[old.id]))!;
  expect(stopped.delivery_state).toBe("held");expect(stopped.meta.mailbox_reply_cancelled_by).toBe(f.message.messageId);
  expect((await queryOne<{delivery_state:string;follow_up_at:string|null}>("select delivery_state,follow_up_at from communications where id=$1",[unrelated.id]))).toMatchObject({delivery_state:"queued",follow_up_at:expect.anything()});
  // A later machine response cannot make the older chase relevant again.
  await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,gmail_thread_id,created_at,subject,meta)
   values($1,$2,$3,'email','inbound',$4,$5,'Automatic reply','{"auto":true}')`,[f.org,f.opp,f.sub,f.thread,new Date(now.getTime()-5000).toISOString()]);
  const params={orgId:f.org,opportunityId:f.opp,subcontractorId:f.sub,trade:"Electrical",to:"supplier@synthetic.test",threadId:f.thread,subject:"Synthetic old chase",html:"<p>Synthetic only</p>"};
  expect(await runWithOrg(f.org,()=>replySendBlock(params,f.org))).toMatch(/already answered/i);
  expect(await runWithOrg(f.org,()=>replySendBlock({...params,sendIntentId:old.id},f.org))).toMatch(/already answered|cancelled/i);
  const provider=vi.fn(async()=>{throw Error("A cancelled chase must never dispatch");});
  const retry=await runWithOrg(f.org,()=>sendScheduledEmail({...params,scheduled:{key,meta:{kind:"followup"}}},provider));
  expect(retry.blocked).toBe(true);expect(provider).not.toHaveBeenCalled();
  expect((await queryOne<{delivery_state:string}>("select delivery_state from communications where id=$1",[old.id]))!.delivery_state).toBe("held");
 });
});
