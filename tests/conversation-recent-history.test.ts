import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const m=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("../lib/db",()=>({query:m.query}));
vi.mock("../lib/data",()=>({currentOrg:async()=>"ours"}));
import { subConversations } from "../lib/domain/conversation";
import { conversationMessages } from "../lib/conversations";
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create table opportunities(id text,org_id text,title text);
 create table communications(id text,org_id text,subcontractor_id text,channel text,direction text,subject text,body text,created_at timestamptz,recipient_email text,gmail_thread_id text,gmail_message_id text,rfc822_message_id text,opportunity_id text,meta jsonb,delivery_state text);
 alter table communications add column delivery_detail text, add column opened_at timestamptz, add column clicked_at timestamptz, add column replied_at timestamptz, add column follow_up_at timestamptz;
 insert into communications(id,org_id,subcontractor_id,channel,direction,subject,body,created_at,gmail_thread_id)
 select n::text,'ours','sub','email','inbound','A conversation','Message '||n,'2026-01-01'::timestamptz+n*interval '1 minute','thread' from generate_series(1,510) n;
 insert into communications(id,org_id,subcontractor_id,channel,direction,body,created_at,gmail_thread_id)
 values('private','theirs','sub','email','inbound','Private','2027-01-01','private');`);
 m.query.mockImplementation(async(sql,params)=>(await db.query(sql,params)).rows);
},30000);
afterAll(async()=>{await db?.close();});
it('retains the newest reply after 500 messages, in reading order and within the tenant',async()=>{
 const conversations=await subConversations('sub','ours');
 expect(conversations).toHaveLength(1);
 const messages=conversations[0].messages;
 expect(messages).toHaveLength(500);
 expect(messages[0].body).toBe('Message 11');
 expect(messages.at(-1)?.body).toBe('Message 510');
 expect(conversations[0].awaitingUs).toBe(true);
});
it('the main inbox also shows the newest message in a long thread',async()=>{
 const messages=await conversationMessages('thread');
 expect(messages).toHaveLength(500);
 expect(messages[0].body).toBe('Message 11');
 expect(messages.at(-1)?.body).toBe('Message 510');
 expect(await conversationMessages('private')).toEqual([]);
});
