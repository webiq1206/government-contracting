import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const m=vi.hoisted(()=>({db:null as PGlite|null,send:vi.fn()}));
vi.mock("../lib/db",()=>({
 query:async(sql:string,p:unknown[]=[]) => (await m.db!.query(sql,p)).rows,
 queryOne:async(sql:string,p:unknown[]=[]) => (await m.db!.query(sql,p)).rows[0]??null,
 transaction:async(fn:(tx:unknown)=>unknown) => m.db!.transaction(fn as never),
}));
vi.mock("../lib/integrations/email-transport",()=>({sendOutreachEmail:m.send}));
import { sendManualEmail } from "../lib/manual-email";
import { sendScheduledEmail } from "../lib/scheduled-email";
import { communicationEvents } from "../lib/communication-events";
import { recordUnmatched } from "../lib/needs-matching";
const org=randomUUID(),other=randomUUID(),opp=randomUUID(),sub=randomUUID(),otherSub=randomUUID();
let legacy:string;
const input=()=>({requestKey:randomUUID(),actorId:'synthetic-operator',params:{orgId:org,opportunityId:opp,subcontractorId:sub,to:'synthetic@example.test',subject:'Synthetic email',text:'Original version',html:'Original version'}});
async function events(id:string){return (await m.db!.query<{kind:string;evidence:Record<string,unknown>;content:Record<string,unknown>|null}>("select kind,evidence,content from communication_events where org_id=$1 and communication_id=$2 order by id",[org,id])).rows;}
beforeAll(async()=>{
 m.db=new PGlite();
 await m.db.exec("create table _migrations(id serial primary key,filename text unique not null,applied_at timestamptz default now(),checksum text)");
 for(const file of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')&&!f.startsWith('130_')).sort()) await m.db.exec(readFileSync(`db/migrations/${file}`,'utf8').replace(/create extension[^;]*;/gi,''));
 for(const id of [org,other]) await m.db.query("insert into organizations(id,name) values($1,'Synthetic evidence tenant')",[id]);
 await m.db.query("insert into opportunities(id,org_id,title,source,stage,status) values($1,$2,'Synthetic solicitation','test','outreach','open')",[opp,org]);
 await m.db.query("insert into subcontractors(id,org_id,company_name) values($1,$3,'Synthetic supplier'),($2,$4,'Foreign supplier')",[sub,otherSub,org,other]);
 legacy=(await m.db.query<{id:string}>("insert into communications(org_id,channel,direction,body,delivery_state,provider,gmail_message_id) values($1,'email','outbound','Old message','sent','gmail','legacy-id') returning id",[org])).rows[0].id;
 await m.db.exec(readFileSync('db/migrations/130_communication_evidence.sql','utf8'));
},120000);
afterAll(async()=>{await m.db?.close();});
it('does not backfill acceptance; preserves a clearly labeled legacy snapshot on first future change',async()=>{
 expect(await events(legacy)).toEqual([]);
 await m.db!.query("update communications set follow_up_at=now() where id=$1",[legacy]);
 const rows=await events(legacy);expect(rows).toHaveLength(2);
 expect(rows[0].evidence.legacy_snapshot).toBe(true);expect(rows[0].content?.body).toBe('Old message');
 expect(rows.every(r=>r.evidence.provider_accepted_at===null)).toBe(true);
});
it('preserves a provider Date header separately from ingestion time without guessing old dates',async()=>{
 const header='Fri, 14 Aug 2026 10:00:00 +0000';
 const id=await recordUnmatched({orgId:org,fromEmail:'synthetic@example.test',messageId:'synthetic-original-date',originalDateHeader:header,receivedAt:new Date(header)});
 const [r]=(await m.db!.query<{original_date_header:string;received_at:Date;created_at:Date}>("select original_date_header,received_at,created_at from unmatched_inbound where id=$1",[id])).rows;
 expect(r.original_date_header).toBe(header);expect(r.received_at.toISOString()).toBe('2026-08-14T10:00:00.000Z');
 expect(r.created_at.getTime()).toBeGreaterThan(r.received_at.getTime());
});
it('records one claim, attempt and acceptance and no duplicate events for replay or no-op updates',async()=>{
 m.send.mockClear();m.send.mockImplementation(async(p)=>{await p.beforeProviderSend('sender@example.test',{mailboxEmail:'synthetic-mailbox@example.test',connectionGeneration:'synthetic-grant-version'});return{provider:'gmail',outcome:'accepted',messageId:'synthetic-receipt'};});
 const req=input();expect((await sendManualEmail(req)).ok).toBe(true);expect((await sendManualEmail(req)).ok).toBe(true);
 expect(m.send).toHaveBeenCalledTimes(1);
 const id=(await m.db!.query<{id:string}>("select id from communications where org_id=$1 and request_key=$2",[org,req.requestKey])).rows[0].id;
 const rows=await events(id);expect(rows.map(r=>r.evidence.delivery_state)).toEqual(['queued','attempting','sent']);
 expect(rows[0].content?.body).toBe('Original version');expect(rows[2].evidence.provider_message_id).toBe('synthetic-receipt');
 expect(rows[1].evidence.provider_account_email).toBe('synthetic-mailbox@example.test');
 expect(rows[1].evidence.provider_connection_generation).toBe('synthetic-grant-version');
 await m.db!.query("update communications set delivery_state=delivery_state,delivery_updated_at=now() where id=$1",[id]);
 expect(await events(id)).toHaveLength(3);
 expect((await communicationEvents(other,id)).rows).toHaveLength(0);
});
it('bounds cursors and retains a restrictive tenant policy for a non-owner reader',async()=>{
 await expect(communicationEvents(org,legacy,'9999999999999999999')).rejects.toThrow('Invalid event cursor');
 await m.db!.exec('create role synthetic_event_reader; grant select on communication_events to synthetic_event_reader;');
 // Even a future permissive policy must not widen the restrictive boundary.
 await m.db!.exec('create policy synthetic_broad_access on communication_events as permissive for select using (true); set role synthetic_event_reader;');
 try {
  await m.db!.query("select set_config('brostco.org_id',$1,false)",[other]);
  expect((await m.db!.query('select id from communication_events')).rows).toHaveLength(0);
  await m.db!.query("select set_config('brostco.org_id',$1,false)",[org]);
  expect((await m.db!.query('select id from communication_events')).rows.length).toBeGreaterThan(0);
 } finally {await m.db!.exec('reset role;drop policy synthetic_broad_access on communication_events;');}
});
it('blocks provider handoff if the atomic attempt-event write fails',async()=>{
 await m.db!.exec(`create function reject_synthetic_attempt() returns trigger language plpgsql as $$begin if new.evidence->>'delivery_state'='attempting' then raise exception 'synthetic attempt evidence failure'; end if; return new; end$$;
 create trigger reject_synthetic_attempt before insert on communication_events for each row execute function reject_synthetic_attempt();`);
 let providerCalls=0;m.send.mockImplementation(async(p)=>{await p.beforeProviderSend('sender@example.test');providerCalls++;return{provider:'gmail',messageId:'should-not-send'};});
 const req=input();
 try{expect((await sendManualEmail(req)).ok).toBe(false);expect(providerCalls).toBe(0);}finally{await m.db!.exec('drop trigger reject_synthetic_attempt on communication_events;drop function reject_synthetic_attempt()');}
 expect((await sendManualEmail(req)).ok).toBe(false);expect(providerCalls).toBe(0);
});
it('preserves uncertainty after provider acceptance when settlement cannot commit and never sends again',async()=>{
 await m.db!.exec(`create function reject_synthetic_settlement() returns trigger language plpgsql as $$begin if new.evidence->>'delivery_state'='sent' then raise exception 'synthetic receipt write failure'; end if; return new; end$$;
 create trigger reject_synthetic_settlement before insert on communication_events for each row execute function reject_synthetic_settlement();`);
 let calls=0;m.send.mockImplementation(async(p)=>{await p.beforeProviderSend('sender@example.test');calls++;return{provider:'gmail',messageId:'accepted-but-uncommitted'};});
 const req=input();
 try{expect((await sendManualEmail(req)).ok).toBe(false);}finally{await m.db!.exec('drop trigger reject_synthetic_settlement on communication_events;drop function reject_synthetic_settlement()');}
 expect((await sendManualEmail(req)).ok).toBe(false);expect(calls).toBe(1);
 const id=(await m.db!.query<{id:string}>("select id from communications where org_id=$1 and request_key=$2",[org,req.requestKey])).rows[0].id;
 expect((await events(id)).map(r=>r.evidence.delivery_state)).toEqual(['queued','attempting']);
});
it('keeps the original intent and every confirmed refusal when a scheduled request safely retries',async()=>{
 const params={...input().params,scheduled:{key:randomUUID(),meta:{kind:'follow-up'}}};
 const refused=async(p:typeof params)=>{await p.beforeProviderSend?.('sender@example.test');return{provider:'gmail' as const,outcome:'refused' as const,error:'Synthetic rejection'};};
 // The transport callback has the wider application type.
 const first=await sendScheduledEmail(params,refused as never);
 const second=await sendScheduledEmail({...params,text:'Revised version'},async(p)=>{await p.beforeProviderSend?.('sender@example.test');return{provider:'gmail',outcome:'accepted',messageId:'scheduled-receipt'};});
 expect(second.communicationId).toBe(first.communicationId);
 const rows=await events(first.communicationId!);
 expect(rows.map(r=>r.evidence.delivery_state)).toEqual(['queued','attempting','failed','queued','attempting','sent']);
 expect(rows.filter(r=>r.content).map(r=>r.content?.body)).toEqual(['Original version','Revised version']);
 expect(rows[2].evidence.delivery_detail).toBe('Synthetic rejection');
 expect((await communicationEvents(org,first.communicationId!)).rows.every(r=>r.evidence.delivery_detail===null)).toBe(true);
});
it('enforces quote-to-inbound attribution within the same tenant, solicitation and supplier',async()=>{
 const inbound=(await m.db!.query<{id:string}>("insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,body) values($1,$2,$3,'email','inbound','Synthetic quote') returning id",[org,opp,sub])).rows[0].id;
 await expect(m.db!.query("insert into quotes(org_id,opportunity_id,subcontractor_id,trade,quote_amount,source_communication_id) values($1,$2,$3,'Electrical',100,$4)",[org,opp,sub,legacy])).rejects.toThrow('Quote source must');
 await m.db!.query("insert into quotes(org_id,opportunity_id,subcontractor_id,trade,quote_amount,source_communication_id) values($1,$2,$3,'Electrical',100,$4)",[org,opp,sub,inbound]);
 expect((await m.db!.query<{source_communication_id:string}>("select source_communication_id from quotes where org_id=$1",[org])).rows[0].source_communication_id).toBe(inbound);
 await expect(m.db!.query("insert into communication_events(org_id,communication_id,kind,evidence) values($1,$2,'state_changed','{}')",[other,inbound])).rejects.toThrow('Tenant ownership');
});
