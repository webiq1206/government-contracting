import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const state = vi.hoisted(() => ({ db: null as PGlite | null, calls: [] as string[] }));
vi.mock("../lib/db", () => ({ queryOne: async (sql: string, args: unknown[]) => {
  state.calls.push(sql);
  return (await state.db!.query(sql, args)).rows[0] ?? null;
} }));
import { LEGACY_ORG_ID } from "../lib/tenant-context";
import { readAiReconciliation } from "../lib/admin/ai-reconciliation";

const otherOrg = "00000000-0000-4000-8000-000000000002";
const eventId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

describe("AI reconciliation inventory (integration)", () => {
  beforeAll(async () => {
    state.db = new PGlite();
    await state.db.exec(`create table api_usage_events (
      id uuid primary key, org_id uuid not null, provider text, service text,
      outcome text, credential_source text, currency text default 'USD',
      started_at timestamptz, finished_at timestamptz,
      reserved_cost numeric, budget_cost numeric, provider_cost numeric,
      provider_request_id text, error_code text, credential_fingerprint text,
      provider_diagnostics jsonb, evidence text
    );
    create table ai_work_receipts (
      org_id uuid, work_key text, scope_key text, input_hash text, owner uuid,
      state text, started_at timestamptz, completed_at timestamptz, result jsonb,
      primary key(org_id,work_key)
    );`);
  });
  beforeEach(async () => {
    await state.db!.exec("truncate api_usage_events, ai_work_receipts");
    state.calls.length = 0;
  });
  afterAll(async () => { await state.db?.close(); });

  async function event(n: number, outcome: string, options: {
    org?: string; cost?: string; budget?: string; reserved?: string; request?: string;
  } = {}) {
    await state.db!.query(`insert into api_usage_events
      (id,org_id,provider,service,outcome,credential_source,started_at,finished_at,
       reserved_cost,budget_cost,provider_cost,provider_request_id,error_code,
       credential_fingerprint,provider_diagnostics,evidence)
      values($1,$2,'OpenAI','gpt-4.1',$3,'platform','2020-01-01',
       case when $3='pending' then null else '2020-01-02'::timestamptz end,
       $4,$5,$6,$7,'Abandoned private detail','private-credential-hash',
       '{"secret":"private-diagnostic-prompt"}','private-evidence')`,
      [eventId(n), options.org ?? LEGACY_ORG_ID, outcome, options.reserved ?? "3",
        options.budget ?? null, options.cost ?? null, options.request ?? "req_held1"]);
  }

  it("finds old held requests across outcomes, excluding known zero cost and other tenants", async () => {
    await event(1, "failed");
    await event(2, "pending");
    await event(3, "success");
    await event(4, "failed", { budget: "0" }); // A known provider refusal is not held.
    await event(5, "success", { cost: "0" });
    await event(6, "failed", { reserved: "0" });
    await event(7, "pending", { org: otherOrg });
    const inventory = await readAiReconciliation();
    expect(inventory.heldReservations).toMatchObject({ total: 3, returned: 3, truncated: false, reservedTotalUsd: "9" });
    expect(inventory.heldReservations.rows.map(row => row.eventId)).toEqual([eventId(1), eventId(2), eventId(3)]);
    expect(inventory.heldReservations.rows.every(row => row.linkageStatus === "not_recorded" && row.linkedReceiptReference === null)).toBe(true);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatch(/^with held as/);
    expect(JSON.stringify(inventory)).not.toMatch(/private-|Abandoned/);
  });

  it("returns opaque pending references without owner tokens, saved output or invented joins", async () => {
    await state.db!.query(`insert into ai_work_receipts
      (org_id,work_key,scope_key,input_hash,owner,state,started_at,result) values
      ($1,$2,'legacy-private-scope','private-input-hash',$3,'pending','2020-01-01','{"private-result":"secret"}'),
      ($1,$4,'v2:private-scope','private-input-hash',$3,'pending','2020-01-01',null),
      ($1,$5,'legacy','private-input-hash',$3,'complete','2020-01-01','{}'),
      ($6,$7,'legacy','private-input-hash',$3,'pending','2020-01-01',null)`,
      [LEGACY_ORG_ID, "a".repeat(64), eventId(90), "b".repeat(64), "c".repeat(64), otherOrg, "d".repeat(64)]);
    const inventory = await readAiReconciliation();
    expect(inventory.pendingWorkReceipts).toMatchObject({ total: 2, returned: 2, truncated: false });
    expect(inventory.pendingWorkReceipts.rows[0]).toMatchObject({ receiptReference: "a".repeat(64), identity: "legacy", hasSavedResult: true, linkedEventId: null });
    expect(inventory.pendingWorkReceipts.rows[1]).toMatchObject({ identity: "provider_independent", hasSavedResult: false });
    expect(JSON.stringify(inventory)).not.toMatch(/private-|secret/);
    expect(JSON.stringify(inventory)).not.toContain(eventId(90));
  });

  it("reports full totals with deterministic truncation and suppresses malformed provider references", async () => {
    await state.db!.query(`insert into api_usage_events
      (id,org_id,provider,service,outcome,credential_source,started_at,reserved_cost,provider_request_id)
      select ('00000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,$1,'OpenAI','gpt-4.1','failed','platform',
        '2020-01-01'::timestamptz,3,'Bearer private-key' from generate_series(1,102) n`, [LEGACY_ORG_ID]);
    const inventory = await readAiReconciliation();
    expect(inventory.heldReservations).toMatchObject({ total: 102, returned: 100, truncated: true, reservedTotalUsd: "306" });
    expect(inventory.heldReservations.rows[0].eventId).toBe(eventId(1));
    expect(inventory.heldReservations.rows[99].eventId).toBe(eventId(100));
    expect(inventory.heldReservations.rows[0]).toMatchObject({ providerRequestId: null, providerRequestIdOmitted: true });
    expect(JSON.stringify(inventory)).not.toContain("private-key");
  });
});
