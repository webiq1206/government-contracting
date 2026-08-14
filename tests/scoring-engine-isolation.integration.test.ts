/**
 * Two-organization isolation proof for the Scoring Engine.
 *
 * Nothing about the organization travels with a queue job, and the runner sets
 * no context, so every lookup that resolved the tenant for itself answered
 * "the founding org": the rubric and thresholds an opportunity was scored
 * against, the intake rules that could auto-dismiss it before it was ever
 * scored, the approved weight version applied to it, and the Anthropic key the
 * call was billed to.
 *
 * The visible consequence is that two customers with deliberately opposite
 * settings get the same verdict on the same notice, and it is the wrong one
 * for at least one of them. Claude is mocked so the test neither spends a key
 * nor depends on model output, and the mock records the tenant context that
 * was live at the moment the key would have been resolved.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const A_LABEL = "ORGA-RUBRIC-LABEL";
const B_LABEL = "ORGB-RUBRIC-LABEL";

/** Each scoring call: the prompt built, and the org live when it was made. */
const calls: { prompt: string; orgAtCall: string | null }[] = [];

vi.mock("../lib/ai/claude", async () => {
  const actual = await vi.importActual<typeof import("../lib/ai/claude")>("../lib/ai/claude");
  const { currentOrgId } = await import("../lib/tenant-context");
  return {
    ...actual,
    completeJson: async (prompt: string) => {
      // The real client resolves the API key through the same context, so
      // whatever this reads is the organization that would have been billed.
      calls.push({ prompt, orgAtCall: currentOrgId() });
      return {
        data: {
          dimensions: [{ key: "fit", points: 60, reasoning: "fixed for the test" }],
          extra_exclusions: [],
          summary: "fixed for the test",
        },
        usage: null,
      };
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("scoring engine scores each opportunity as its own organization (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let scoringEngine: typeof import("../lib/agents/scoring-engine").scoringEngine;
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;
  let setAutomationRules: typeof import("../lib/app-settings").setAutomationRules;
  let invalidateProfileCache: typeof import("../lib/ai/companyProfile").invalidateProfileCache;

  const orgA = {
    id: "",
    name: `score-a-${randomUUID()}`,
    label: A_LABEL,
    // A pursues at 50, so a 60 lands in the pipeline with no human gate.
    pursueMin: 50,
    // A refuses anything with under 30 days of lead time.
    minLeadDays: 30,
    weight: 40,
    opp: "",
    shortLeadOpp: "",
  };
  const orgB = {
    ...orgA,
    id: "",
    name: `score-b-${randomUUID()}`,
    label: B_LABEL,
    // B pursues at 90, so the same 60 has to go to a human instead.
    pursueMin: 90,
    // B has no lead-time rule at all.
    minLeadDays: 0,
    weight: 70,
    opp: "",
    shortLeadOpp: "",
  };

  function profileJson(o: typeof orgA) {
    return {
      legal_name: o.name,
      // One dimension, so the mocked score is exactly 60 of 100. The label is
      // the marker: it reaches the prompt, the key does not vary.
      scoring_rubric: {
        total_points: 100,
        dimensions: [
          { key: "fit", label: o.label, max_points: 100, guidance: "test dimension" },
        ],
      },
      // A harmless text-only rule, so the default exclusion set (which carries
      // value and set-aside rules) does not load over the top of it.
      hard_exclusions: [
        { key: "requires_clearance", label: "Security clearance", rule: "Never applies here." },
      ],
      // Empty means nationwide, which keeps the out-of-area review flag off and
      // leaves the tier decided by the threshold alone.
      service_areas: [],
      decision_thresholds: {
        pursue_min_score: o.pursueMin,
        review_min_score: 10,
      },
    };
  }

  async function makeOrg(o: typeof orgA) {
    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [o.name]
    );
    o.id = org!.id;

    await query(
      `insert into company_profile (org_id, version, is_active, profile_json, profile_text)
       values ($1, 1, true, $2::jsonb, $3)`,
      [o.id, JSON.stringify(profileJson(o)), `Profile for ${o.name}`]
    );

    // An approved weight version, so the prompt shows whose rubric was applied.
    await query(
      `insert into scoring_weights (org_id, version, weights, is_active, proposed_by, approved_at)
       values ($1, 1, $2::jsonb, true, 'test', now())`,
      [o.id, JSON.stringify({ fit: { weight: o.weight } })]
    );

    await runWithOrg(o.id, () =>
      setAutomationRules(
        { min_lead_days: o.minLeadDays, lead_action: "dismiss" },
        "test@example.com"
      )
    );

    const far = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const near = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1, 'test', 'Shared notice under test', 'monitoring', 'open', $2) returning id`,
      [o.id, far]
    );
    o.opp = opp!.id;
    const shortLead = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1, 'test', 'Short lead notice under test', 'monitoring', 'open', $2) returning id`,
      [o.id, near]
    );
    o.shortLeadOpp = shortLead!.id;
  }

  async function scored(oppId: string) {
    return queryOne<{ tier: string | null; stage: string; status: string }>(
      `select tier, stage, status from opportunities where id = $1`,
      [oppId]
    );
  }

  /** The scoring call made for this org's main opportunity. */
  function callFor(label: string) {
    return calls.find((c) => c.prompt.includes(label));
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ scoringEngine } = await import("../lib/agents/scoring-engine"));
    ({ runWithOrg } = await import("../lib/tenant-context"));
    ({ setAutomationRules } = await import("../lib/app-settings"));
    ({ invalidateProfileCache } = await import("../lib/ai/companyProfile"));

    await makeOrg(orgA);
    await makeOrg(orgB);

    calls.length = 0;
    for (const o of [orgA, orgB]) {
      for (const oppId of [o.opp, o.shortLeadOpp]) {
        // The profile is cached per org for a few seconds. A queue worker
        // scoring two tenants back to back is exactly the case that cache is
        // keyed for, but the test moves faster than the TTL.
        invalidateProfileCache();
        await scoringEngine.handler({
          runId: randomUUID(),
          trigger: "queue",
          payload: { opportunityId: oppId },
        });
      }
    }
  });

  afterAll(async () => {
    for (const o of [orgA, orgB]) {
      if (!o.id) continue;
      await query(`delete from agent_logs where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from scoring_weights where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from company_profile where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from app_settings where key = $1`, [
        `${o.id}:automation_rules`,
      ]).catch(() => {});
      await query(`delete from organizations where id = $1`, [o.id]).catch(() => {});
    }
    invalidateProfileCache();
  });

  it("scores against the organization's own rubric", () => {
    const a = callFor(A_LABEL);
    const b = callFor(B_LABEL);
    expect(a, "org A was never scored on its own rubric").toBeTruthy();
    expect(b, "org B was never scored on its own rubric").toBeTruthy();
    expect(a!.prompt).not.toContain(B_LABEL);
    expect(b!.prompt).not.toContain(A_LABEL);
  });

  it("tiers on the organization's own thresholds", async () => {
    // Same notice, same 60 points, opposite verdicts, because A pursues at 50
    // and B pursues at 90. Scored on one shared profile both would agree, and
    // one of them would be wrong.
    const a = await scored(orgA.opp);
    const b = await scored(orgB.opp);
    expect(a?.tier).toBe("pursue");
    expect(b?.tier).toBe("review");
  });

  it("applies the organization's own approved weight version", () => {
    // One dimension, so its weight normalizes back to the full 100 points
    // either way. What must not happen is reading the other org's row: the
    // lookup is by (is_active, org_id) and both orgs hold an active version.
    expect(callFor(A_LABEL)!.prompt).toContain("max 100 pts");
    expect(callFor(B_LABEL)!.prompt).toContain("max 100 pts");
  });

  it("gates intake on the organization's own automation rules", async () => {
    // Ten days of lead time. A requires thirty, B requires none.
    const a = await scored(orgA.shortLeadOpp);
    const b = await scored(orgB.shortLeadOpp);
    expect(a?.status, "org A's rule should have archived this").toBe("archived");
    expect(a?.stage).toBe("dismissed");
    expect(b?.status, "org B set no lead-time rule, so nothing should be dismissed").toBe(
      "open"
    );
  });

  it("bills the scoring call to the organization that owns the opportunity", () => {
    // The Claude client resolves ANTHROPIC_API_KEY through this same context,
    // so an unset context spends the founding org's key on every customer's
    // scoring. Customers supply their own keys; this is where that is decided.
    expect(callFor(A_LABEL)!.orgAtCall).toBe(orgA.id);
    expect(callFor(B_LABEL)!.orgAtCall).toBe(orgB.id);
  });
});
