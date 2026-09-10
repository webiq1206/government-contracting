import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock("../lib/db", () => ({
  query: async (s: string, p: unknown[] = []) => (await state.db!.query(s, p)).rows,
  queryOne: async (s: string, p: unknown[] = []) => (await state.db!.query(s, p)).rows[0] ?? null,
  transaction: async (fn: (tx: unknown) => unknown) => state.db!.transaction(fn),
}));
import { adminAccountPage } from "../lib/admin/accounts";
import { accessLevel } from "../lib/billing/entitlements";
import { reserveGmailQuota } from "../lib/integrations/gmail-quota";
import { loadBounceCursor, saveBounceCursor } from "../lib/recap/bounce-cursor";
import { LEGACY_ORG_ID } from "../lib/tenant-context";
const other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec("create table _migrations(id serial primary key,filename text unique not null,applied_at timestamptz default now(),checksum text)");
  for (const f of readdirSync("db/migrations").filter(f => f.endsWith(".sql")).sort()) {
    await state.db.exec(readFileSync("db/migrations/" + f, "utf8").replace(/create extension[^;]*;/gi, ""));
  }
  await state.db.exec(`insert into organizations(name,slug,subscription_status,classification,trial_ends_at)
    select 'Paged account '||lpad(n::text,3,'0'),'paged-'||n,
      case when n%3=0 then 'active' when n%3=1 then 'trial' else 'canceled' end,
      'customer', now()+interval '1 day' from generate_series(1,83) n`);
  await state.db.query("insert into organizations(id,name,slug,classification) values($1,'Internal audit','internal-audit','internal')", [other]);
  await state.db.query(`insert into integration_tokens(provider,org_id,data,email,status) values
    ('gmail',$1,'{}','shared@example.test','connected'), ('gmail',$2,'{}','SHARED@example.test','connected')
    on conflict(provider,org_id) do update set email=excluded.email`, [LEGACY_ORG_ID,other]);
}, 120000);
afterAll(async () => { await state.db?.close(); });
const sort = { key: "name", direction: "asc" as const };
describe("bounded account lists", () => {
  it("returns a bounded page with full filtered totals and no duplicates across pages", async () => {
    const a = await adminAccountPage({ q: "Paged account" }, sort, { per: "25" });
    const b = await adminAccountPage({ q: "Paged account" }, sort, { per: "25", page: "2" });
    expect(a.total).toBe(83);
    expect(a.rows).toHaveLength(25);
    expect(b.rows).toHaveLength(25);
    expect(new Set([...a.rows,...b.rows].map(r=>r.id)).size).toBe(50);
    expect(a.rows[0].name).toBe("Paged account 001");
    expect(b.rows[0].name).toBe("Paged account 026");
    expect(a.customers).toBe(b.customers);
  });
  it("clamps stale page links and preserves entitlement and overview totals under filters", async () => {
    const all = await adminAccountPage({ q: "Paged account" }, sort, { page: "999", per: "25" });
    expect(all.paging.page).toBe(4);
    expect(all.rows).toHaveLength(8);
    const trials = await adminAccountPage({ q: "Paged account", access: "trial" }, sort, {});
    expect(trials.total).toBe(28);
    expect(trials.customers).toBe(all.customers);
    for (const row of trials.rows) expect(row.access).toBe(accessLevel(row));
    expect((await adminAccountPage({ q: "Paged account", kind: "internal" }, sort, {})).total).toBe(0);
  });
  it("treats SQL syntax and wildcard characters as literal search text", async () => {
    const result = await adminAccountPage({ q: "%' OR 1=1" }, { key: "name; drop table organizations", direction: "asc" }, {});
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });
});
describe("shared mailbox pacing and durable bounce progress", () => {
  it("shares allowance across organizations connected to the same mailbox", async () => {
    await reserveGmailQuota(LEGACY_ORG_ID, 2005);
    await expect(reserveGmailQuota(other, 1000)).rejects.toThrow("next minute");
    await reserveGmailQuota(other, 120);
    const usage = await state.db!.query<{ units: number }>("select units from gmail_quota_windows");
    expect(usage.rows).toEqual([{ units: 2125 }]);
  });
  it("resets an expired window and admits only one competing large reservation", async () => {
    await state.db!.exec("update gmail_quota_windows set window_start=now()-interval '2 minutes'");
    const results = await Promise.allSettled([reserveGmailQuota(LEGACY_ORG_ID,2000),reserveGmailQuota(other,2000)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(await reserveGmailQuota(LEGACY_ORG_ID, 2000, 20)).toBe(500);
    await expect(reserveGmailQuota(other,20)).rejects.toThrow("next minute");
  });
  it("resumes across runs and rejects stale cursor writers", async () => {
    const initial = await loadBounceCursor(180);
    await saveBounceCursor(initial,"older-page");
    const continued = await loadBounceCursor(180);
    expect(continued.after_sec).toBe(initial.after_sec);
    expect(continued.page_token).toBe("older-page");
    await expect(saveBounceCursor(initial,"wrong-page")).rejects.toThrow("Another inbox scan");
    await saveBounceCursor(continued);
    const finished = await loadBounceCursor(180);
    expect(finished.page_token).toBeNull();
    expect(Number(finished.after_sec)).toBe(Number(initial.scan_started_sec)-300);
  });
});
