import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const state=vi.hoisted(()=>({db:null as PGlite|null,fail:false,lost:false}));
vi.mock("../lib/db",()=>({queryOne:async(sql:string,args:unknown[]=[])=>{
  if(sql.includes("provider_accepted_at=case") && state.fail) throw Error("write failed");
  const row=(await state.db!.query(sql,args)).rows[0] ?? null;
  if(sql.includes("provider_accepted_at=case") && state.lost) throw Error("ACK lost");
  return row;
}}));
import { sendScheduledEmail,scheduledRequestKey } from "../lib/scheduled-email";
import { sentEmailSql,uncertainEmailSql } from "../lib/domain/email-reporting";
import type { OutreachSendParams } from "../lib/integrations/email-transport";
const org=randomUUID(),sub=randomUUID();
const input=(key:string):OutreachSendParams=>({orgId:org,subcontractorId:sub,to:"sub@example.test",subject:"Scope",text:"Quote please",html:"Quote please",scheduled:{key,meta:{kind:"outreach"},followUpAt:"2030-01-01"}});
const send=vi.fn(async(p:OutreachSendParams)=>{await p.beforeProviderSend!("hello@brostco.com");return {provider:"gmail" as const,outcome:"accepted" as const,messageId:randomUUID(),threadId:"thread"};});
const rows=async(key:string)=>(await state.db!.query<Record<string,unknown>>("select * from communications where org_id=$1 and request_key=$2",[org,scheduledRequestKey(key)])).rows;
beforeAll(async()=>{state.db=new PGlite();await state.db.exec(`create table communications(
 id uuid primary key default gen_random_uuid(),org_id uuid,subcontractor_id uuid,opportunity_id uuid,
 channel text,direction text,subject text,body text,recipient_email text,gmail_thread_id text,gmail_message_id text,
 rfc822_message_id text,tracking_id uuid,delivery_state text,request_key uuid,request_fingerprint text,meta jsonb,
 sender_email text,provider text,delivery_detail text,provider_attempted_at timestamptz,provider_accepted_at timestamptz,
 delivery_updated_at timestamptz,created_at timestamptz default now(),follow_up_at timestamptz);
 create unique index communications_request_key_unique on communications(org_id,request_key) where request_key is not null;`);},60000);
afterAll(async()=>{await state.db?.close();});
beforeEach(()=>{state.fail=false;state.lost=false;send.mockClear();});
describe("scheduled send crash recovery",()=>{
 it("serializes concurrent sweeps and recovers an accepted receipt without duplicate rows or changed copy",async()=>{
  const key=randomUUID(),p=input(key);await Promise.all([sendScheduledEmail(p,send),sendScheduledEmail(p,send)]);
  const result=await sendScheduledEmail({...p,text:"changed copy"},send);
  expect(result).toMatchObject({replayed:true,outcome:"accepted"});expect(send).toHaveBeenCalledTimes(1);
  expect(await rows(key)).toHaveLength(1);expect((await rows(key))[0]).toMatchObject({body:"Quote please",delivery_state:"sent",sender_email:"hello@brostco.com"});
 });
 it.each(["queued","attempting","unknown"])("never expires %s into another provider call",async(status)=>{
  const key=randomUUID();await state.db!.query("insert into communications(org_id,subcontractor_id,request_key,delivery_state,created_at) values($1,$2,$3,$4,now()-interval '90 days')",[org,sub,scheduledRequestKey(key),status]);
  for(let i=0;i<3;i++) expect(await sendScheduledEmail(input(key),send)).toMatchObject({outcome:"unknown",retryable:false});
  expect(send).not.toHaveBeenCalled();
 });
 it("keeps accepted-but-timeout sends blocked",async()=>{
  const key=randomUUID();const timeout=vi.fn(async(p:OutreachSendParams)=>{await p.beforeProviderSend!("sender");throw Error("provider ACK lost");});
  await sendScheduledEmail(input(key),timeout);await sendScheduledEmail(input(key),timeout);
  expect(timeout).toHaveBeenCalledTimes(1);expect((await rows(key))[0].delivery_state).toBe("attempting");
 });
 it("holds when receipt persistence fails",async()=>{
  const key=randomUUID();state.fail=true;await sendScheduledEmail(input(key),send);state.fail=false;
  expect(await sendScheduledEmail(input(key),send)).toMatchObject({outcome:"unknown",retryable:false});expect(send).toHaveBeenCalledTimes(1);
 });
 it("recovers committed receipt after lost write ACK",async()=>{
  const key=randomUUID();state.lost=true;await sendScheduledEmail(input(key),send);state.lost=false;
  expect(await sendScheduledEmail(input(key),send)).toMatchObject({replayed:true});expect(send).toHaveBeenCalledTimes(1);
 });
 it.each([false,true])("retries only confirmed hold/refusal and refreshes actual retry metadata (%s)",async(refused)=>{
  const key=randomUUID();await sendScheduledEmail(input(key),async p=>{if(refused) await p.beforeProviderSend!("sender");return {provider:refused?"gmail":null,error:"held/refused",outcome:refused?"refused":"not_attempted"};});
  const trackingId=randomUUID();const p={...input(key),trackingId,threadId:"new-thread"};
  await Promise.all([sendScheduledEmail(p,send),sendScheduledEmail(p,send)]);
  expect(send).toHaveBeenCalledTimes(1);expect((await rows(key))[0].tracking_id).toBe(trackingId);
 });
 it("isolates tenant scopes",async()=>{
  const key=randomUUID();await sendScheduledEmail(input(key),send);await sendScheduledEmail({...input(key),orgId:randomUUID()},send);expect(send).toHaveBeenCalledTimes(2);
 });
 it("holds changed compliance intents behind unresolved or recent requests",async()=>{
  for(const status of ["unknown","sent"]){const contact=randomUUID();await state.db!.query("insert into communications(org_id,subcontractor_id,delivery_state,meta) values($1,$2,$3,$4::jsonb)",[org,contact,status,JSON.stringify({kind:"compliance-chase"})]);
   const p={...input(randomUUID()),subcontractorId:contact,scheduled:{key:randomUUID(),meta:{kind:"compliance-chase"}}};
   expect(await sendScheduledEmail(p,send)).toMatchObject({outcome:"unknown",retryable:false});}
  expect(send).not.toHaveBeenCalled();
 });
 it("reports acceptance separately from uncertain allowance reservations and refusals",async()=>{
  const tenant=randomUUID();for(const status of ["sent","failed","held","queued","attempting","unknown"])
   await state.db!.query("insert into communications(org_id,channel,direction,provider,delivery_state) values($1,'email','outbound','gmail',$2)",[tenant,status]);
  const count=await state.db!.query(`select count(*) filter(where ${sentEmailSql()})::int as sent,count(*) filter(where (${sentEmailSql()}) or (${uncertainEmailSql()}))::int as reserved from communications c where org_id=$1`,[tenant]);
  expect(count.rows[0]).toEqual({sent:1,reserved:3});
 });
});
