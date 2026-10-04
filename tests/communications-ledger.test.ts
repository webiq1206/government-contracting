import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../lib/db", () => ({ query: m.query }));
import { communicationsLedger } from "../lib/communications-ledger";
let db: PGlite;
const org = randomUUID(), other = randomUUID(), sub = randomUUID(), project = randomUUID();
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table subcontractors(id uuid,org_id uuid,company_name text);
    create table opportunities(id uuid,org_id uuid,title text);
    create table communications(id uuid default gen_random_uuid(),org_id uuid,subcontractor_id uuid,opportunity_id uuid,
      channel text default 'email',direction text default 'outbound',subject text,body text,
      created_at timestamptz default now(),provider text default 'gmail',sender_email text,recipient_email text,
      gmail_message_id text,gmail_thread_id text,delivery_state text default 'sent',delivery_detail text,opened_at timestamptz,clicked_at timestamptz,replied_at timestamptz);`);
  await db.query("insert into subcontractors values($1,$2,'Acme')", [sub, org]);
  await db.query("insert into opportunities values($1,$2,'Paint the station')", [project, org]);
  await db.query(`insert into communications(org_id,subcontractor_id,opportunity_id,body,created_at,gmail_thread_id,sender_email,recipient_email)
    select $1,$2,$3,'Message '||n,'2026-01-01'::timestamptz+(n/2)*interval '1 second','long-thread','original@sender.test','saved@recipient.test' from generate_series(1,555) n`, [org, sub, project]);
  await db.query("insert into communications(org_id,body,gmail_thread_id) values($1,'private message','long-thread')", [other]);
  m.query.mockImplementation(async (sql, params) => (await db.query(sql, params)).rows);
}, 30000);
afterAll(async () => { await db?.close(); });
it("pages all 555 records with same-timestamp ties without leaking another tenant or repeating rows", async () => {
  const ids: string[] = []; let before: string | undefined;
  do {
    const page = await communicationsLedger(org, { thread: "long-thread", before });
    expect(page.rows.length).toBeLessThanOrEqual(50);
    for (const row of page.rows) { expect(row.body).not.toContain("private"); ids.push(row.id); }
    before = page.next ?? undefined;
  } while (before);
  expect(ids).toHaveLength(555); expect(new Set(ids).size).toBe(555);
});
it("searches bodies, saved addresses, contacts and projects; percent is literal", async () => {
  expect((await communicationsLedger(org, { q: "Message 555" })).rows).toHaveLength(1);
  for (const q of ["original@sender", "saved@recipient", "Acme", "station"])
    expect((await communicationsLedger(org, { q })).rows).toHaveLength(50);
  expect((await communicationsLedger(org, { q: "%" })).rows).toHaveLength(0);
  expect((await communicationsLedger(org, { sub: randomUUID() })).rows).toHaveLength(0);
  expect((await communicationsLedger(org, { sub: "malformed" })).rows).toHaveLength(0);
});
it("keeps failed, uncertain, replied and held evidence separate, with missing provider evidence unknown", async () => {
  for (const [state, provider, replied] of [["failed", "gmail", true], ["unknown", "gmail", true], ["held", null, false], ["sent", null, false], ["sent", "gmail", true]])
    await db.query("insert into communications(org_id,subject,delivery_state,provider,replied_at) values($1,'outcomes',$2,$3,case when $4 then now() end)", [org,state,provider,replied]);
  expect((await communicationsLedger(org, { q: "outcomes", status: "refused" })).rows.map(r => r.state)).toEqual(["failed"]);
  expect((await communicationsLedger(org, { q: "outcomes", status: "unknown" })).rows.map(r => r.state)).toEqual(["unknown","unknown"]);
  expect((await communicationsLedger(org, { q: "outcomes", status: "replied" })).rows.map(r => r.state)).toEqual(["replied"]);
  expect((await communicationsLedger(org, { q: "outcomes", status: "held" })).rows.map(r => r.state)).toEqual(["held"]);
});
