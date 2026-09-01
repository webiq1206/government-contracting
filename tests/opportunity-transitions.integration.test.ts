/**
 * The three stage changes, through one service, against a real database.
 *
 * They were written twice, once in the single-record route and once in the
 * bulk route, as two copies of the same UPDATE. The copies agreed when they
 * were written, which is the only time copies ever do, and the first change
 * either of them needed proved it: a column that has to be cleared when a
 * record leaves review. A bulk pass that skipped it would leave records able
 * to be dismissed automatically on a warning issued about a decision somebody
 * had already made.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

vi.mock("../lib/queue", () => ({
  enqueue: vi.fn(async () => undefined),
  QUEUE_NAMES: [],
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

d("opportunity transitions (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let t: typeof import("../lib/opportunity-transitions");

  const mine = { id: "" };
  const theirs = { id: "" };

  async function makeOpp(orgId: string, warned = true) {
    const row = await queryOne<{ id: string }>(
      `insert into opportunities
         (org_id, source, title, stage, status, tier, human_action_required,
          deadline, review_expires_at, review_warned_at)
       values ($1,'test','Review me','scoring','open','review', true,
               now() + interval '30 days', now() + interval '1 day',
               case when $2 then now() else null end)
       returning id`,
      [orgId, warned]
    );
    return row!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    t = await import("../lib/opportunity-transitions");
    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`trans-${randomUUID()}`]
      );
      org.id = o!.id;
    }
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from agent_logs where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from communications where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from call_cards where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from subcontractors where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from opportunities where org_id=$1`, [org.id]);
      await query(`delete from organizations where id=$1`, [org.id]);
    }
    vi.restoreAllMocks();
  });

  it("clears the expiry warning when a record leaves review", async () => {
    /*
     * The warning belongs to one decision. A record that comes back to review
     * later must be warned again on its own merits, not carry a warning issued
     * about a decision somebody already made.
     */
    const id = await makeOpp(mine.id);
    expect(await t.pursueOpportunity(mine.id, id, "op@x.invalid")).toBe(true);
    const row = await queryOne<{
      stage: string;
      review_warned_at: Date | null;
      review_expires_at: Date | null;
    }>(`select stage, review_warned_at, review_expires_at from opportunities where id=$1`, [id]);
    expect(row?.stage).toBe("analysis");
    expect(row?.review_warned_at).toBeNull();
    expect(row?.review_expires_at).toBeNull();
  });

  it("clears it on a pass and on a move too", async () => {
    const passed = await makeOpp(mine.id);
    await t.passOpportunity(mine.id, passed, "Out of our area", "op@x.invalid");
    const a = await queryOne<{ review_warned_at: Date | null; notes: string | null }>(
      `select review_warned_at, notes from opportunities where id=$1`,
      [passed]
    );
    expect(a?.review_warned_at).toBeNull();
    // The reason is appended to the notes rather than replacing them.
    expect(a?.notes).toContain("Out of our area");
    const pursuit = await queryOne<{ pursuit_state: string; status: string }>(
      `select pursuit_state, status from opportunities where id=$1`,
      [passed]
    );
    expect(pursuit?.pursuit_state).toBe("aborted");
    expect(pursuit?.status).toBe("archived");

    const moved = await makeOpp(mine.id);
    await t.moveOpportunity(mine.id, moved, "outreach", "op@x.invalid", "scoring");
    const b = await queryOne<{ review_warned_at: Date | null; stage: string }>(
      `select review_warned_at, stage from opportunities where id=$1`,
      [moved]
    );
    expect(b?.review_warned_at).toBeNull();
    expect(b?.stage).toBe("outreach");
  });

  it("flags for a person exactly when the target stage has no agent", async () => {
    // Derived from the agent list rather than passed in, because those two
    // facts must not be able to disagree.
    const human = await makeOpp(mine.id);
    await t.moveOpportunity(mine.id, human, "quote_entry", "op@x.invalid", "outreach");
    const a = await queryOne<{ human_action_required: boolean }>(
      `select human_action_required from opportunities where id=$1`,
      [human]
    );
    expect(a?.human_action_required).toBe(true);

    const automatic = await makeOpp(mine.id);
    await t.moveOpportunity(mine.id, automatic, "analysis", "op@x.invalid", "scoring");
    const b = await queryOne<{ human_action_required: boolean }>(
      `select human_action_required from opportunities where id=$1`,
      [automatic]
    );
    expect(b?.human_action_required).toBe(false);
  });

  it("stops scheduled follow-ups and pending calls when an opportunity is passed", async () => {
    const id = await makeOpp(mine.id);
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, email)
       values ($1,'Close Work Sub','sub@x.invalid') returning id`,
      [mine.id]
    );
    await query(
      `insert into communications
         (org_id, opportunity_id, subcontractor_id, channel, direction, subject, body, follow_up_at)
       values ($1,$2,$3,'email','outbound','Quote?','Please quote', now() + interval '1 day')`,
      [mine.id, id, sub!.id]
    );
    await query(
      `insert into call_cards (org_id, opportunity_id, subcontractor_id, card_json, status)
       values ($1,$2,$3,'{}','pending')`,
      [mine.id, id, sub!.id]
    );

    await t.passOpportunity(mine.id, id, "Wrong trade", "op@x.invalid");

    const follow = await queryOne<{ follow_up_at: Date | null }>(
      `select follow_up_at from communications where opportunity_id=$1`,
      [id]
    );
    const call = await queryOne<{ status: string }>(
      `select status from call_cards where opportunity_id=$1`,
      [id]
    );
    expect(follow?.follow_up_at).toBeNull();
    expect(call?.status).toBe("skipped");
  });

  it("refuses to touch another organization's record", async () => {
    const theirOpp = await makeOpp(theirs.id);
    expect(await t.pursueOpportunity(mine.id, theirOpp, "op@x.invalid")).toBe(false);
    expect(await t.passOpportunity(mine.id, theirOpp, "nope", "op@x.invalid")).toBe(false);
    expect((await t.moveOpportunity(mine.id, theirOpp, "analysis", "op@x.invalid", "scoring")).ok).toBe(
      false
    );
    const row = await queryOne<{ stage: string; tier: string }>(
      `select stage, tier from opportunities where id=$1`,
      [theirOpp]
    );
    expect(row?.stage).toBe("scoring");
    expect(row?.tier).toBe("review");
  });
});
