/**
 * Ranking and removing subcontractors on a bid, against a real database.
 *
 * Two rules here live in the schema rather than in the code, and both are the
 * kind that only fails when two people are working the same bid at once.
 *
 * One primary per trade is a partial unique index. The promotion path demotes
 * the incumbent in its own statement precisely because the index would
 * otherwise refuse the write, so an index that stopped being enforced would
 * turn a correct promotion into two primaries and a pricing workspace reading
 * whichever the query returned first.
 *
 * A removal must carry a reason, which is a check constraint. And a removal is
 * a mark rather than a delete, so the emails and replies stay attached; that
 * is the whole point, and it is worth a test that counts them afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("opportunity subs (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let mod: typeof import("../lib/opportunity-subs");

  const mine = { id: "" };
  const theirs = { id: "" };
  const opp = { id: "" };
  const theirOpp = { id: "" };
  const subs: string[] = [];
  const pairings: string[] = [];

  async function makeSub(name: string, orgId: string): Promise<string> {
    const row = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, email, email_verified, phone)
       values ($1,$2,'{Electrical}',$3,true,'555-0100') returning id`,
      [orgId, name, `${name.toLowerCase().replace(/\W+/g, "")}-${randomUUID()}@x.invalid`]
    );
    subs.push(row!.id);
    return row!.id;
  }

  async function pair(oppId: string, subId: string, trade = "Electrical"): Promise<string> {
    const row = await queryOne<{ id: string }>(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade)
       values ($1,$2,$3) returning id`,
      [oppId, subId, trade]
    );
    pairings.push(row!.id);
    return row!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    mod = await import("../lib/opportunity-subs");

    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`osub-${randomUUID()}`]
      );
      org.id = o!.id;
    }
    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1,'test','Fort Bliss HVAC','outreach','open', now() + interval '30 days') returning id`,
      [mine.id]
    );
    opp.id = op!.id;
    const other = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1,'test','Their job','outreach','open', now() + interval '30 days') returning id`,
      [theirs.id]
    );
    theirOpp.id = other!.id;
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from communications where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from opportunities where org_id=$1`, [org.id]);
      await query(`delete from subcontractors where org_id=$1`, [org.id]);
      await query(`delete from organizations where id=$1`, [org.id]);
    }
  });

  it("promotes one firm and demotes whoever held the slot", async () => {
    const a = await pair(opp.id, await makeSub("Alpha Electric", mine.id));
    const b = await pair(opp.id, await makeSub("Bravo Electric", mine.id));

    expect((await mod.setPairingRole(mine.id, opp.id, a, "primary")).ok).toBe(true);
    expect((await mod.setPairingRole(mine.id, opp.id, b, "primary")).ok).toBe(true);

    const rows = await query<{ id: string; role: string | null }>(
      `select id, role from opportunity_subs where id = any($1::uuid[])`,
      [[a, b]]
    );
    const byId = new Map(rows.map((r) => [r.id, r.role]));
    expect(byId.get(b)).toBe("primary");
    // Demoted rather than left as a second primary. The pricing workspace
    // reads the primary to build the bid, and two of them is whichever the
    // query happens to return first.
    expect(byId.get(a)).toBe("backup");
  });

  it("clears the rank when the same one is asked for twice", async () => {
    const a = await pair(opp.id, await makeSub("Charlie Electric", mine.id), "Plumbing");
    await mod.setPairingRole(mine.id, opp.id, a, "backup");
    const second = await mod.setPairingRole(mine.id, opp.id, a, "backup");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.role).toBeNull();
  });

  it("the database refuses two primaries in a trade even without the service", async () => {
    // The demotion in setPairingRole makes the promotion work. This is what
    // makes it necessary: remove the index and this test is the one that goes
    // red, not a screen somebody notices six weeks later.
    const t = `Roofing-${randomUUID().slice(0, 8)}`;
    const a = await pair(opp.id, await makeSub("Delta Roofing", mine.id), t);
    const b = await pair(opp.id, await makeSub("Echo Roofing", mine.id), t);
    await query(`update opportunity_subs set role='primary' where id=$1`, [a]);
    await expect(
      query(`update opportunity_subs set role='primary' where id=$1`, [b])
    ).rejects.toThrow();
  });

  it("keeps the history when a firm comes off the bid", async () => {
    const subId = await makeSub("Foxtrot Electric", mine.id);
    const p = await pair(opp.id, subId, "Painting");
    await query(
      `insert into communications (org_id, opportunity_id, subcontractor_id, channel, direction, subject)
       values ($1,$2,$3,'email','outbound','Quote request')`,
      [mine.id, opp.id, subId]
    );

    const res = await mod.removePairing(mine.id, opp.id, p, "Declined the scope", null);
    expect(res.ok).toBe(true);

    const row = await queryOne<{ removed_reason: string; role: string | null }>(
      `select removed_reason, role from opportunity_subs where id=$1`,
      [p]
    );
    expect(row?.removed_reason).toBe("Declined the scope");
    // A firm off the bid holds no rank. Leaving them primary would leave the
    // trade with a primary nobody is talking to.
    expect(row?.role).toBeNull();

    const kept = await queryOne<{ n: string }>(
      `select count(*)::text as n from communications where subcontractor_id=$1`,
      [subId]
    );
    expect(kept?.n).toBe("1");
  });

  it("refuses a removal with no reason", async () => {
    const p = await pair(opp.id, await makeSub("Golf Electric", mine.id), "Concrete");
    const res = await mod.removePairing(mine.id, opp.id, p, "   ", null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);

    const row = await queryOne<{ removed_at: Date | null }>(
      `select removed_at from opportunity_subs where id=$1`,
      [p]
    );
    expect(row?.removed_at).toBeNull();
  });

  it("the database refuses a removal with no reason even without the service", async () => {
    const p = await pair(opp.id, await makeSub("Hotel Electric", mine.id), "Masonry");
    await expect(
      query(`update opportunity_subs set removed_at = now() where id=$1`, [p])
    ).rejects.toThrow();
  });

  it("puts a removed firm back without erasing that it happened", async () => {
    const p = await pair(opp.id, await makeSub("India Electric", mine.id), "Glazing");
    await mod.removePairing(mine.id, opp.id, p, "Wrong trade", null);
    expect((await mod.restorePairing(mine.id, opp.id, p)).ok).toBe(true);
    const row = await queryOne<{ removed_at: Date | null }>(
      `select removed_at from opportunity_subs where id=$1`,
      [p]
    );
    expect(row?.removed_at).toBeNull();
  });

  it("will not rank a firm that is off the bid", async () => {
    const p = await pair(opp.id, await makeSub("Juliet Electric", mine.id), "Fencing");
    await mod.removePairing(mine.id, opp.id, p, "Out of area", null);
    const res = await mod.setPairingRole(mine.id, opp.id, p, "primary");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
  });

  it("corrects an address and marks it unverified", async () => {
    const subId = await makeSub("Kilo Electric", mine.id);
    const p = await pair(opp.id, subId, "Drywall");
    const res = await mod.correctContact(mine.id, opp.id, p, { email: "fixed@x.invalid" });
    expect(res.ok).toBe(true);

    const row = await queryOne<{ email: string; email_verified: boolean }>(
      `select email, email_verified from subcontractors where id=$1`,
      [subId]
    );
    expect(row?.email).toBe("fixed@x.invalid");
    // A hand-corrected address is not a verified one. Marking it verified here
    // would let outreach send to it as though a bounce check had passed, which
    // is the failure the correction exists to recover from.
    expect(row?.email_verified).toBe(false);
  });

  it("refuses something that is not an address", async () => {
    const p = await pair(opp.id, await makeSub("Lima Electric", mine.id), "Paving");
    const res = await mod.correctContact(mine.id, opp.id, p, { email: "not-an-address" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("cannot reach a pairing in another organization", async () => {
    const theirSub = await makeSub("Mike Electric", theirs.id);
    const theirPair = await pair(theirOpp.id, theirSub);

    // 404 rather than 403, on every path.
    expect(await mod.pairing(mine.id, theirOpp.id, theirPair)).toBeNull();
    expect((await mod.setPairingRole(mine.id, theirOpp.id, theirPair, "primary")).ok).toBe(false);
    expect((await mod.removePairing(mine.id, theirOpp.id, theirPair, "because", null)).ok).toBe(
      false
    );
    expect(
      (await mod.correctContact(mine.id, theirOpp.id, theirPair, { email: "x@y.invalid" })).ok
    ).toBe(false);

    const untouched = await queryOne<{ role: string | null; removed_at: Date | null }>(
      `select role, removed_at from opportunity_subs where id=$1`,
      [theirPair]
    );
    expect(untouched?.role).toBeNull();
    expect(untouched?.removed_at).toBeNull();
  });

  it("leaves removed firms out of the active roster", async () => {
    const p = await pair(opp.id, await makeSub("November Electric", mine.id), "Signage");
    const before = await mod.activePairings(mine.id, opp.id);
    await mod.removePairing(mine.id, opp.id, p, "Never replied", null);
    const after = await mod.activePairings(mine.id, opp.id);
    expect(after.length).toBe(before.length - 1);
    expect(after.some((r) => r.id === p)).toBe(false);
  });
});
