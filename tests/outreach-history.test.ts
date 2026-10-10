import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const m = vi.hoisted(() => ({query:vi.fn()}));
vi.mock("../lib/db",()=>({query:m.query}));
import { outreachHistory } from "../lib/outreach-history";
import { unmatchedHistory } from "../lib/unmatched-history";
let db:PGlite;
const org=randomUUID(),other=randomUUID(),project=randomUUID(),project2=randomUUID(),sub=randomUUID(),foreignSub=randomUUID();
const asOf="2026-10-10T15:00:00.000Z";
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create table subcontractors(id uuid,org_id uuid,company_name text,email_source text,email_verified boolean);
    create table opportunities(id uuid,org_id uuid,title text,solicitation_number text,status text,stage text,pursuit_state text);
    create table communications(id uuid default gen_random_uuid(),org_id uuid,subcontractor_id uuid,opportunity_id uuid,
      channel text default 'email',direction text default 'outbound',subject text,body text,meta jsonb,
      created_at timestamptz default '2026-10-01',provider text,sender_email text,recipient_email text,
      gmail_message_id text,gmail_thread_id text,rfc822_message_id text,provider_attempted_at timestamptz,provider_accepted_at timestamptz,
      delivery_state text,delivery_detail text,opened_at timestamptz,clicked_at timestamptz,replied_at timestamptz,follow_up_at timestamptz);
    create table quotes(org_id uuid,opportunity_id uuid,subcontractor_id uuid);
    create table subcontractor_reply_events(org_id uuid,gmail_message_id text,opportunity_id uuid,subcontractor_id uuid,needs_review boolean,reviewed_at timestamptz);
    create table unmatched_inbound(id uuid default gen_random_uuid(),org_id uuid,received_at timestamptz,from_email text,from_name text,subject text,snippet text,subcontractor_id uuid,state text,message_id text,attachment_names jsonb,unreadable_attachments jsonb,original_date_header text,created_at timestamptz default now());`);
  await db.query(`insert into opportunities values($1,$3,'Station repair','SYN-1','open','outreach','active'),($2,$3,'Closed example','SYN-2','closed','lost','aborted')`,[project,project2,org]);
  await db.query(`insert into subcontractors values($1,$3,'Synthetic supplier','website_scrape',false),($2,$4,'Private other tenant','secret',true)`,[sub,foreignSub,org,other]);
  await db.query(`insert into communications(org_id,subcontractor_id,opportunity_id,subject,body,delivery_state,provider,gmail_message_id)
    select $1,$2,case when n<=80 then $3::uuid else $4::uuid end,'Synthetic record '||n,'Original content '||n,'sent','gmail','legacy-'||n from generate_series(1,155) n`,[org,sub,project,project2]);
  await db.query(`insert into communications(org_id,subcontractor_id,opportunity_id,subject,body,delivery_state,created_at)
    values($1,$3,$4,'private','Private other tenant','sent','2026-10-01'),($2,$3,$4,'foreign relation','Local row; foreign join must be empty','draft','2026-10-01'),($2,null,null,'outside cohort','future record','sent','2026-10-11')`,[other,org,foreignSub,randomUUID()]);
  await db.query(`insert into quotes values($1,$3,$4),($2,$3,$4)`,[org,other,project,sub]);
  await db.query(`insert into unmatched_inbound(org_id,received_at,from_email,subject,snippet,subcontractor_id,state)
    select $1,'2026-08-01'::timestamptz+(n/3)*interval '1 second','sender@example.test','Queue record '||n,
      case when n=10108 then 'Synthetic exact quote response 40% discount' else 'Synthetic queued mail' end,
      case when n=10108 then $2::uuid end,'needs_matching' from generate_series(1,10108) n`,[org,sub]);
  await db.query(`insert into unmatched_inbound(org_id,received_at,from_email,subject,snippet,subcontractor_id,state)
    values($1,'2026-08-02','private@example.test','private','Private other tenant',$3,'needs_matching'),
      ($2,'2026-08-02','local@example.test','foreign relation','Local row only',$3,'needs_matching'),
      ($2,'2026-08-02','dismissed@example.test','dismissed','Already dismissed',null,'dismissed')`,[other,org,foreignSub]);
  m.query.mockImplementation(async(sql,params)=>(await db.query(sql,params)).rows);
},30000);
afterAll(async()=>{await db?.close();});
it('pages same-time records exactly once and reconciles account/project totals',async()=>{
  const ids:string[]=[];let before:string|undefined;
  do { const p=await outreachHistory(org,{asOf,before});
    expect(p.total).toBe(156); expect(Object.values(p.counts).reduce((a,b)=>a+b,0)).toBe(p.total);
    expect(p.projectCounts.reduce((a,b)=>a+b.messages,0)).toBe(p.total);
    p.rows.forEach(r=>{expect(r.body).not.toContain('Private other tenant');expect(r.company_name).not.toBe('Private other tenant');ids.push(r.id);});
    before=p.next ?? undefined;
  }while(before);
  expect(ids).toHaveLength(156);expect(new Set(ids).size).toBe(156);
  const p=await outreachHistory(org,{asOf,project});expect(p.total).toBe(80);expect(p.counts.historical).toBe(80);
  expect(p.projectCounts[0].opportunity_title).toBe('Station repair');
  expect(p.rows.every(r=>r.related_quote_count===1)).toBe(true);
  const closed=await outreachHistory(org,{asOf,project:project2});
  expect(closed.rows[0].next_action).toContain('do not resume outreach');
});
it('does not infer acceptance from old sent/delivered labels, tracking, or an ID alone',async()=>{
  for(const [state,provider,id,accepted] of [['sent','gmail','receipt',true],['sent','gmail','legacy',false],['delivered','gmail','tracking',false],['sent',null,'id',true],['unknown','gmail','id',true],['held','gmail','id',true]])
    await db.query(`insert into communications(org_id,subject,delivery_state,provider,gmail_message_id,provider_accepted_at,opened_at,delivery_detail)
      values($1,'Evidence cases',$2,$3,$4,case when $5 then '2026-10-01'::timestamptz end,'2026-10-01','Private diagnostic')`,[org,state,provider,id,accepted]);
  const p=await outreachHistory(org,{asOf,q:'Evidence cases'});
  expect(p.counts.accepted).toBe(1);expect(p.counts.historical).toBe(3);expect(p.counts.uncertain).toBe(1);expect(p.counts.held).toBe(1);
  expect(p.rows.every(r=>r.delivery_detail===null)).toBe(true);
  expect((await outreachHistory(org,{asOf,q:'Evidence cases'},true)).rows[0].delivery_detail).toBe('Private diagnostic');
});
it('keeps absence notices separate and uses the same filtered cohort for counts and rows',async()=>{
  await db.query(`insert into communications(org_id,direction,subject,body) values
    ($1,'inbound','Re: outreach','I am currently out of the office, but I will return Wednesday.'),
    ($1,'inbound','Re: outreach','We are interested. Our quote will follow.')`,[org]);
  const p=await outreachHistory(org,{asOf,status:'automatic'});expect(p.total).toBe(1);expect(p.counts.automatic).toBe(1);
  expect(p.rows[0].next_action).toContain('not a substantive answer');
  expect((await outreachHistory(org,{asOf,q:'%'})).total).toBe(0);
  await expect(outreachHistory(org,{project:'invalid'})).rejects.toThrow('Invalid solicitation');
  await expect(outreachHistory(org,{before:Buffer.from('null').toString('base64url')})).rejects.toThrow('Invalid history cursor');
});
it('finds known-supplier mail beyond 10,000 queue records without leaking cross-tenant supplier names',async()=>{
  const p=await unmatchedHistory(org);expect(p.total).toBe(10109);expect(p.rows).toHaveLength(50);
  const p2=await unmatchedHistory(org,{after:p.next!});expect(p2.total).toBe(10109);
  expect(new Set([...p.rows,...p2.rows].map(r=>r.id)).size).toBe(100);
  const known=await unmatchedHistory(org,{known:'yes'});expect(known.total).toBe(1);expect(known.rows[0].subject).toBe('Queue record 10108');
  expect((await unmatchedHistory(org,{q:'40%'})).total).toBe(1);
  expect((await unmatchedHistory(org,{q:'Private other tenant'})).total).toBe(0);
  await db.query(`update unmatched_inbound set message_id='captured-copy',attachment_names='["Synthetic estimate.pdf"]',unreadable_attachments='["Synthetic estimate.pdf"]' where org_id=$1 and subject='Queue record 10108'`,[org]);
  await db.query(`insert into communications(org_id,direction,gmail_message_id,gmail_thread_id) values($1,'inbound','captured-copy','saved-thread')`,[org]);
  const captured=(await unmatchedHistory(org,{known:'yes'})).rows[0];
  expect(captured.capturedThreadKey).toBe('saved-thread');expect(captured.unreadableAttachments).toEqual(['Synthetic estimate.pdf']);
  const badRelation=await unmatchedHistory(org,{q:'foreign relation'});expect(badRelation.rows[0].subcontractorName).toBeNull();
  await expect(unmatchedHistory(org,{after:'bad'})).rejects.toThrow('Invalid unmatched');
});
