/**
 * The slot statements run on Postgres-compatible SQL.
 *
 * Overlapping callers are covered in rfq-reservation.test.ts. This file checks
 * that the same statements insert a claim only while the locked count is under
 * the cap.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ db: null as PGlite | null }));

vi.mock("../lib/db", () => ({
  tenantTransaction: async (
    _orgId: string,
    fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>
  ) => {
    const db = state.db!;
    await db.exec("begin");
    try {
      const result = await fn({
        query: async (sql: string, params?: unknown[]) => db.query(sql, params),
      });
      await db.exec("commit");
      return result;
    } catch (err) {
      await db.exec("rollback");
      throw err;
    }
  },
}));

import { reserveRfqSendSlot } from "../lib/domain/rfq-reservation";

describe("quote-request slot SQL", () => {
  const orgId = randomUUID();
  const opportunityId = randomUUID();

  beforeAll(async () => {
    state.db = new PGlite();
    await state.db.exec(`
      create table communications (
        id uuid primary key default gen_random_uuid(),
        org_id uuid,
        opportunity_id uuid,
        subcontractor_id uuid,
        channel text,
        direction text,
        delivery_state text,
        created_at timestamptz not null default now(),
        meta jsonb
      );
      create table rfq_daily_slots (
        org_id uuid not null,
        utc_day date not null,
        primary key (org_id, utc_day)
      );
      create table rfq_send_claims (
        id uuid primary key default gen_random_uuid(),
        org_id uuid not null,
        utc_day date not null,
        opportunity_id uuid not null,
        subcontractor_id uuid not null,
        trade text not null default '',
        state text not null,
        created_at timestamptz not null default now()
      );
    `);
  });

  it("accepts two claims and refuses the third when the daily cap is 2", async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await reserveRfqSendSlot({
        orgId,
        opportunityId,
        subcontractorId: randomUUID(),
        trade: "electrical",
        dailyCap: 2,
        perTradeCap: 5,
      }));
      // Past the pacing gap, so only the cap decides.
      await state.db!.query("update rfq_send_claims set created_at = created_at - interval '10 minutes' where org_id = $1", [orgId]);
    }
    expect(results.map((result) => result.ok)).toEqual([true, true, false]);
    expect(results[2]).toMatchObject({ ok: false, reason: "daily_cap" });
    const claims = await state.db!.query("select state from rfq_send_claims where org_id = $1", [orgId]);
    expect(claims.rows).toHaveLength(2);
  });

  it("spaces quote requests out instead of sending them in a burst", async () => {
    const reserve = () => reserveRfqSendSlot({
      orgId, opportunityId, subcontractorId: randomUUID(), trade: "electrical", dailyCap: 100, perTradeCap: 5,
    });
    expect(await reserve()).toMatchObject({ ok: true });
    const paced = await reserve();
    expect(paced).toMatchObject({ ok: false, reason: "pace" });
    expect((paced as { waitSeconds: number }).waitSeconds).toBeGreaterThan(0);
    expect((paced as { waitSeconds: number }).waitSeconds).toBeLessThanOrEqual(180);
    await state.db!.query("update rfq_send_claims set created_at = created_at - interval '4 minutes' where org_id = $1", [orgId]);
    expect(await reserve()).toMatchObject({ ok: true });
  });
});
