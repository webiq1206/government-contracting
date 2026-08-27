/**
 * A firm that travels to the work.
 *
 * Sub Finder matched a subcontractor's own address against the state the work
 * is in, so a firm based one county over who covers that state and has said so
 * was invisible to every job there. The service area exists precisely to
 * record that, and the geography guard it sits behind is still the one that
 * matters: without a known state the query used to fall open to every state in
 * the country.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const TRADE = "Electrical";
const WORK_STATE = "TX";

d("Sub Finder and a recorded service area (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let subFinder: typeof import("../lib/agents/sub-finder").subFinder;

  const org = { id: "", oppId: "" };
  const ids: Record<string, string> = {};

  async function makeSub(key: string, cols: Record<string, unknown>) {
    const names = Object.keys(cols);
    const row = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, email, email_verified${names.length ? ", " + names.join(", ") : ""})
       values ($1,$2,$3,$4,true${names.map((_, i) => `, $${i + 5}`).join("")}) returning id`,
      [org.id, `${key}-${randomUUID().slice(0, 8)}`, [TRADE], `${key}@example.invalid`,
       ...names.map((n) => cols[n])]
    );
    ids[key] = row!.id;
    return row!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ subFinder } = await import("../lib/agents/sub-finder"));

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`area-${randomUUID()}`]
    );
    org.id = o!.id;
    await query(
      `insert into company_profile (org_id, version, is_active, profile_json, profile_text)
       values ($1, 1, true, $2::jsonb, 'Profile')`,
      [org.id, JSON.stringify({
        primary_trades: [TRADE],
        sub_standards: { candidates_per_trade: 6, verify_top_n: 2 },
      })]
    );
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, location_state)
       values ($1,'test','Fort Bliss electrical','sub_research','open',$2) returning id`,
      [org.id, WORK_STATE]
    );
    org.oppId = opp!.id;

    await makeSub("local", { state: WORK_STATE });
    // Based next door, covers this state, and has said so.
    await makeSub("travels", { state: "NM", service_area_states: [WORK_STATE, "NM"] });
    // Based next door, and has said which states they cover. This is not one.
    await makeSub("staysHome", { state: "NM", service_area_states: ["NM", "AZ"] });
    // Based next door, nobody has ever asked about their travel.
    await makeSub("unasked", { state: "NM" });

    await subFinder.handler({
      runId: randomUUID(), trigger: "queue", payload: { opportunityId: org.oppId },
    });
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from opportunity_subs where opportunity_id = $1`, [org.oppId]).catch(() => {});
    await query(`delete from agent_logs where org_id = $1`, [org.id]).catch(() => {});
    await query(`delete from opportunities where org_id = $1`, [org.id]).catch(() => {});
    await query(`delete from subcontractors where org_id = $1`, [org.id]).catch(() => {});
    await query(`delete from company_profile where org_id = $1`, [org.id]).catch(() => {});
    await query(`delete from organizations where id = $1`, [org.id]).catch(() => {});
  });

  async function paired() {
    const rows = await query<{ subcontractor_id: string }>(
      `select subcontractor_id from opportunity_subs where opportunity_id = $1`,
      [org.oppId]
    );
    return new Set(rows.map((r) => r.subcontractor_id));
  }

  it("pairs a firm in the working state", async () => {
    expect((await paired()).has(ids.local)).toBe(true);
  });

  it("pairs a firm from the next state who covers this one", async () => {
    // The whole point of recording a service area. Without this they were
    // invisible to every job in a state they work in every week.
    expect((await paired()).has(ids.travels)).toBe(true);
  });

  it("does not pair a firm whose stated area excludes this state", async () => {
    // They have answered the question, and the answer was no.
    expect((await paired()).has(ids.staysHome)).toBe(false);
  });

  it("does not pair a firm nobody has asked, on their address alone", async () => {
    /*
     * Unasked is not the same as yes. Their address is in another state and
     * they have made no claim about travelling, so the address is all there
     * is to go on and it says no. Sourcing can still find them for a job in
     * their own state.
     */
    expect((await paired()).has(ids.unasked)).toBe(false);
  });
});
