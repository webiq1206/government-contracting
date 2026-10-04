import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ db: null as PGlite | null, send: vi.fn(), org: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
vi.mock("../lib/db", () => ({
  query: async (s: string, p: unknown[] = []) => (await state.db!.query(s, p)).rows,
  queryOne: async (s: string, p: unknown[] = []) => (await state.db!.query(s, p)).rows[0] ?? null,
}));
vi.mock("../lib/integrations/email-transport", () => ({ sendOutreachEmail: state.send }));
vi.mock("../lib/org-guard", () => ({ requireOrgContext: async () => ({ orgId: state.org, user: { id: "operator", email: "operator@example.test" } }) }));
vi.mock("../lib/logger", () => ({ logAgent: vi.fn() }));
import { sendManualEmail } from "../lib/manual-email";
import { recordUnmatched } from "../lib/needs-matching";
import { POST as editContact } from "../app/api/subs/[id]/route";
import { sentEmailSql, neverSentEmailSql } from "../lib/domain/email-reporting";

const sub = randomUUID();
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec("create table _migrations(id serial primary key,filename text unique not null,applied_at timestamptz default now(),checksum text)");
  for (const name of readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort())
    await state.db.exec(readFileSync(`db/migrations/${name}`, "utf8").replace(/create extension[^;]*;/gi, ""));
  for (const id of [state.org, other]) await state.db.query("insert into organizations(id,name,slug) values($1,$2,$2)", [id,id]);
  await state.db.query("insert into subcontractors(id,org_id,company_name,email,email_verified) values($1,$2,'Known firm','sub@example.test',true)", [sub, state.org]);
  state.send.mockImplementation(async (params) => {
    await params.beforeProviderSend("Sender <sender@example.test>");
    return { provider: "gmail", messageId: randomUUID(), threadId: "synthetic-thread" };
  });
}, 120000);
afterAll(async () => { await state.db?.close(); });

describe("mail recovery against a disposable PostgreSQL engine", () => {
  it("uses the unique constraint to serialize duplicate sends and stores identity and receipt", async () => {
    const requestKey = randomUUID();
    const input = { requestKey, actorId: "operator", params: { orgId: state.org, subcontractorId: sub,
      to: "sub@example.test", subject: "Scope", text: "Please confirm.", html: "Please confirm." } };
    const results = await Promise.all([sendManualEmail(input), sendManualEmail(input)]);
    expect(results.some((r) => r.ok)).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);
    const saved = await state.db!.query<{ sender_email: string; provider_attempted_at: string; provider_accepted_at: string; delivery_state: string }>(
      "select * from communications where org_id=$1 and request_key=$2", [state.org, requestKey]);
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]).toMatchObject({ sender_email: "Sender <sender@example.test>", delivery_state: "sent" });
    expect(saved.rows[0].provider_attempted_at).toBeTruthy();
    expect(saved.rows[0].provider_accepted_at).toBeTruthy();
    expect((await sendManualEmail(input)).ok).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it("stores NUL-bearing imported headers, bodies and nested attachment fields without stalling", async () => {
    const receivedAt = new Date("2026-09-11T10:00:00Z");
    const id = await recordUnmatched({ orgId: state.org, fromEmail: "sub@example.test", fromName: "Name\0",
      subject: "Quote\0", body: "Price 10\0,000", messageId: "synthetic-nul", references: ["<id\0@example.test>"],
      attachmentNames: ["scope\0.txt"], receivedAt });
    const saved = await state.db!.query<{ snippet: string; received_at: Date; attachment_names: string[] }>("select * from unmatched_inbound where id=$1", [id]);
    expect(saved.rows[0].snippet).toBe("Price 10\uFFFD,000");
    expect(saved.rows[0].attachment_names).toEqual(["scope\uFFFD.txt"]);
    expect(new Date(saved.rows[0].received_at).toISOString()).toBe(receivedAt.toISOString());
    expect(await recordUnmatched({ orgId: state.org, fromEmail: "sub@example.test", messageId: "synthetic-nul" })).toBeNull();
  });
  it("invalidates verification only for an actual address change and rejects foreign edits", async () => {
    const edit = (email: string) => editContact(new Request("https://example.test", { method: "POST", body: JSON.stringify({ email }) }), { params: Promise.resolve({ id: sub }) });
    expect((await edit("SUB@example.test")).status).toBe(200);
    expect((await state.db!.query<{ email_verified: boolean }>("select email_verified from subcontractors where id=$1", [sub])).rows[0].email_verified).toBe(true);
    expect((await edit("replacement@example.test")).status).toBe(200);
    expect((await state.db!.query<{ email_verified: boolean }>("select email_verified from subcontractors where id=$1", [sub])).rows[0].email_verified).toBe(false);
    expect((await edit("bad-address")).status).toBe(400);
    state.org = other;
    expect((await edit("foreign@example.test")).status).toBe(404);
    state.org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  });
  it("counts accepted messages separately from queued, held, failed and uncertain attempts", async () => {
    for (const status of ["queued", "attempting", "unknown", "held", "failed", "draft"])
      await state.db!.query("insert into communications(org_id,channel,direction,delivery_state) values($1,'email','outbound',$2)", [state.org, status]);
    const count = await state.db!.query<{ sent: number; failed: number }>(`select
      count(*) filter (where ${sentEmailSql()})::int as sent,
      count(*) filter (where ${neverSentEmailSql()})::int as failed from communications c where c.org_id=$1`, [state.org]);
    expect(count.rows[0]).toEqual({ sent: 1, failed: 1 });
  });
});
