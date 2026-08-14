/**
 * Two-organization isolation proof for the Learning Loop.
 *
 * Nothing here reaches a screen, which is why it would have stayed hidden: the
 * loop read every tenant's decided bids and every tenant's active weights, and
 * proposed each customer a rubric tuned on strangers' outcomes. The proposal
 * itself was then written with no org, and the approval screen reads by org,
 * so the customer could never have approved or even seen it.
 *
 * The prompt is the evidence, because the prompt IS the tuning input. Claude is
 * mocked to capture it, which also keeps the test off the API.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const A_MARK = "ORGA-LOSS-REASON";
const B_MARK = "ORGB-LOSS-REASON";
const A_WEIGHT = 11;
const B_WEIGHT = 22;

/** Every analysis prompt the loop built, in order. */
const prompts: string[] = [];

vi.mock("../lib/ai/claude", async () => {
  const actual = await vi.importActual<typeof import("../lib/ai/claude")>("../lib/ai/claude");
  return {
    ...actual,
    completeJson: async (prompt: string) => {
      prompts.push(prompt);
      return {
        data: {
          weight_adjustments: [
            { key: "fit", current_weight: 10, proposed_weight: 15, rationale: "test" },
          ],
          pricing_insight: "",
          agency_insights: "",
          summary: "",
          supporting_data: {},
        },
        usage: null,
      };
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("learning loop tunes each organization on its own data (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let learningLoop: typeof import("../lib/agents/learning-loop").learningLoop;

  const orgA = { id: "", name: `learn-a-${randomUUID()}` };
  const orgB = { id: "", name: `learn-b-${randomUUID()}` };

  async function makeOrg(o: typeof orgA, mark: string, weight: number) {
    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [o.name]
    );
    o.id = org!.id;

    // The baseline the proposal is a delta against.
    await query(
      `insert into scoring_weights (org_id, version, weights, is_active, proposed_by)
       values ($1, 1, $2::jsonb, true, 'test')`,
      [o.id, JSON.stringify({ fit: { weight } })]
    );

    // The analysis needs at least 20 decided bids before it proposes anything.
    for (let i = 0; i < 20; i++) {
      const opp = await queryOne<{ id: string }>(
        `insert into opportunities (org_id, source, title, stage, status)
         values ($1, 'test', $2, 'submitted', 'open') returning id`,
        [o.id, `${o.name} opp ${i}`]
      );
      await query(
        `insert into bids (org_id, opportunity_id, bid_amount, margin_pct, outcome, loss_reason)
         values ($1, $2, 100000, 12, $3, $4)`,
        [o.id, opp!.id, i % 2 === 0 ? "won" : "lost", mark]
      );
    }
  }

  /** The prompt built for the org carrying this marker. */
  function promptFor(mark: string) {
    return prompts.find((p) => p.includes(mark));
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ learningLoop } = await import("../lib/agents/learning-loop"));
    await makeOrg(orgA, A_MARK, A_WEIGHT);
    await makeOrg(orgB, B_MARK, B_WEIGHT);
    prompts.length = 0;
    await learningLoop.handler({ runId: randomUUID(), trigger: "cron", payload: {} });
  });

  afterAll(async () => {
    for (const o of [orgA, orgB]) {
      if (!o.id) continue;
      await query(`delete from scoring_weights where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from agent_logs where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from bids where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from organizations where id = $1`, [o.id]).catch(() => {});
    }
  });

  it("analyzes only the organization's own decided bids", () => {
    const a = promptFor(A_MARK);
    const b = promptFor(B_MARK);
    expect(a, "org A got no analysis pass of its own").toBeTruthy();
    expect(b, "org B got no analysis pass of its own").toBeTruthy();
    expect(a).not.toContain(B_MARK);
    expect(b).not.toContain(A_MARK);
  });

  it("proposes against the organization's own active weights", () => {
    // A proposal is a delta from the current rubric. Read from the wrong org
    // it is a delta from a rubric this customer has never seen.
    expect(promptFor(A_MARK)).toContain(`"weight":${A_WEIGHT}`);
    expect(promptFor(A_MARK)).not.toContain(`"weight":${B_WEIGHT}`);
    expect(promptFor(B_MARK)).toContain(`"weight":${B_WEIGHT}`);
  });

  it("files the proposal under the organization that has to approve it", async () => {
    for (const o of [orgA, orgB]) {
      const proposed = await query<{ org_id: string | null; version: number }>(
        `select org_id, version from scoring_weights
          where org_id = $1 and proposed_by = 'learning-loop' and is_active = false`,
        [o.id]
      );
      expect(proposed.length, `${o.name} has no proposal to approve`).toBe(1);
      expect(proposed[0].org_id).toBe(o.id);
      // Versions are per org, so each starts from its own active v1.
      expect(proposed[0].version).toBe(2);
    }
  });
});
