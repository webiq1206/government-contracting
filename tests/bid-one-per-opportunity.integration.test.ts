/**
 * One bid per opportunity, under concurrency.
 *
 * The builder reads "is there a bid?" then updates or inserts. A genuine race
 * — two builds interleaving between the read and the write — used to produce
 * two bid rows for one opportunity, stranding the fingerprint and the
 * operator's confirmations on whichever row lost. A unique index plus an
 * upsert make that impossible; this proves it against a real database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("one bid per opportunity (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  const org = { id: "" };
  const opp = { id: "" };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`onebid-${randomUUID()}`]
    );
    org.id = o!.id;
    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status)
       values ($1,'test','One-bid opportunity','bid_building','open') returning id`,
      [org.id]
    );
    opp.id = op!.id;
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from bids where opportunity_id=$1`, [opp.id]).catch(() => {});
    await query(`delete from opportunities where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
  });

  it("rejects a second bid row for the same opportunity", async () => {
    await query(`insert into bids (opportunity_id, outcome) values ($1,'pending')`, [opp.id]);
    await expect(
      query(`insert into bids (opportunity_id, outcome) values ($1,'pending')`, [opp.id])
    ).rejects.toThrow(/duplicate key|unique/i);
    const rows = await query<{ n: number }>(
      `select count(*)::int n from bids where opportunity_id=$1`,
      [opp.id]
    );
    expect(rows[0].n).toBe(1);
  });

  it("upserts on conflict rather than raising, so concurrent builds converge", async () => {
    // Simulate the builder's on-conflict path directly: a second insert with
    // the same opportunity becomes an update.
    await query(
      `insert into bids (opportunity_id, bid_amount, outcome) values ($1, 200000, 'pending')
       on conflict (opportunity_id) do update set bid_amount=excluded.bid_amount, updated_at=now()`,
      [opp.id]
    );
    const row = await queryOne<{ n: number; amt: string | null }>(
      `select count(*)::int n, max(bid_amount)::text amt from bids where opportunity_id=$1`,
      [opp.id]
    );
    expect(row!.n).toBe(1);
    expect(Number(row!.amt)).toBe(200000);
  });
});
