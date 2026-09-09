import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../lib/db", () => ({
  query: async (s: string, p: unknown[] = []) =>
    (await state.db.query(s, p)).rows,
}));
import { readActivity, activityCsv, csvCell } from "../lib/activity/read";
const org = "00000000-0000-4000-8000-000000000001",
  other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(
    "create table _migrations(id serial primary key,filename text unique not null,applied_at timestamptz default now(),checksum text)",
  );
  for (const file of readdirSync("db/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await state.db.exec(
      readFileSync("db/migrations/" + file, "utf8").replace(
        /create extension[^;]*;/gi,
        "",
      ),
    );
  }
  await state.db.query(
    "insert into organizations(id,name,slug) values($1,'Other','other-test')",
    [other],
  );
}, 120000);
afterAll(async () => {
  await state.db?.close();
});
describe("tenant activity history", () => {
  it("captures drafts and later send transitions without pretending delivery", async () => {
    const {
      rows: [c],
    } = await state.db.query(
      "insert into communications(org_id,channel,direction,subject,body,recipient_email,delivery_state) values($1,'email','outbound','Roof quote','Please quote the roof.','roofer@example.com','draft') returning id",
      [org],
    );
    await state.db.query(
      "update communications set delivery_state='sent' where id=$1",
      [c.id],
    );
    const result = await readActivity(org, new URLSearchParams("q=Roof"));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.status).sort()).toEqual(["draft", "sent"]);
    expect(result.rows[0].detail.body).toBe("Please quote the roof.");
    expect(result.rows[0].historical).toBe(false);
  });
  it("isolates tenants, including filters and totals", async () => {
    await state.db.query(
      "insert into communications(org_id,channel,direction,subject,body) values($1,'email','inbound','Secret other account','private-body')",
      [other],
    );
    expect(
      (await readActivity(org, new URLSearchParams("q=private-body"))).summary
        .total,
    ).toBe(0);
    expect(
      (await readActivity(other, new URLSearchParams("q=private-body"))).summary
        .total,
    ).toBe(1);
  });
  it("ignores irrelevant updates and excludes raw provider data", async () => {
    const {
      rows: [c],
    } = await state.db.query(
      "insert into communications(org_id,channel,direction,subject,meta) values($1,'email','outbound','Safe subject','{\"access_token\":\"secret\"}') returning id",
      [org],
    );
    await state.db.query(
      'update communications set meta=\'{"access_token":"new secret"}\' where id=$1',
      [c.id],
    );
    const result = await readActivity(
      org,
      new URLSearchParams("q=Safe subject"),
    );
    expect(result.rows).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("access_token");
  });
  it("counts the entire result while paginating", async () => {
    await state.db.query(
      "insert into communications(org_id,channel,direction,subject) select $1,'email','inbound','Pagination '||n from generate_series(1,57) n",
      [org],
    );
    const result = await readActivity(org, new URLSearchParams("q=Pagination"));
    expect(result.summary.total).toBe(57);
    expect(result.rows).toHaveLength(50);
    expect(
      (await readActivity(org, new URLSearchParams("q=Pagination&page=2")))
        .rows,
    ).toHaveLength(7);
  });
  it("does not leak markup or costs into the tenant activity projection", async () => {
    const result = await state.db.query(
      'select activity_projection(\'{"provider_cost":10,"credential_fingerprint":"secret","tenant_charge":12.5,"service":"test"}\') as p',
    );
    expect(result.rows[0].p).toEqual({ tenant_charge: 12.5, service: "test" });
  });
  it("escapes spreadsheet formulas and quotes", () => {
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(activityCsv([])).toContain("Historical snapshot");
  });
});
