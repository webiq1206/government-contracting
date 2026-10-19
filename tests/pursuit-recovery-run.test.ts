import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  enqueue: vi.fn(),
  log: vi.fn(),
  rules: vi.fn(),
  profile: vi.fn(),
  alert: vi.fn(),
  openIncident: vi.fn(),
  advance: vi.fn(),
}));

vi.mock("../lib/db", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("../lib/queue", () => ({ enqueue: mocks.enqueue }));
vi.mock("../lib/logger", () => ({ logAgent: mocks.log }));
vi.mock("../lib/app-settings", () => ({ getAutomationRules: mocks.rules }));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileJson: mocks.profile }));
vi.mock("../lib/outage-alert", () => ({ deliverOutageAlert: mocks.alert }));
vi.mock("../lib/incidents", () => ({
  openOrUpdateIncident: mocks.openIncident,
  advance: mocks.advance,
  IllegalTransition: class IllegalTransition extends Error {},
}));
vi.mock("../lib/tenant-context", () => ({
  runWithOrg: async (_orgId: string, fn: () => unknown) => fn(),
}));

import { recoverOpenPursuitGaps } from "../lib/domain/pursuit-recovery-run";

const quietCounts = {
  undecided_band: 0,
  band_decisions: 0,
  unsourced: 0,
  finder_runs: 0,
  unverified: 0,
  verify_runs: 0,
  unsent: 0,
  outreach_runs: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rules.mockResolvedValue({
    autonomous_review_decisions: true,
    rfq_outbound_enabled: true,
    work_execution: "sub",
  });
  mocks.profile.mockResolvedValue({
    decision_thresholds: { pursue_min_score: 70, review_min_score: 50 },
  });
  mocks.enqueue.mockResolvedValue("job-1");
  mocks.alert.mockResolvedValue("email");
  mocks.openIncident.mockResolvedValue({ id: "incident-1" });
  mocks.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("pipeline-stall-counts")) return quietCounts;
    if (sql.includes("automation_incidents")) return null;
    return { id: "claimed" };
  });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("band-backfill-candidates")) return [{ id: "band-1" }];
    if (sql.includes("pursue-source-candidates")) return [{ id: "pursue-1" }];
    if (sql.includes("pursue-verify-candidates")) {
      return [{ opportunity_id: "pursue-1", subcontractor_id: "sub-1", trade: "roofing" }];
    }
    if (sql.includes("pursue-outreach-candidates")) {
      return [{ opportunity_id: "pursue-1", subcontractor_id: "sub-2", trade: "electrical" }];
    }
    return [];
  });
});

describe("recovery sweep for decisions and pursue work", () => {
  it("queues a band decision without rescoring, then verify and outreach for pursue pairings", async () => {
    const result = await recoverOpenPursuitGaps(["org-1"]);
    const agents = mocks.enqueue.mock.calls.map((call) => call[0]);
    expect(agents).toEqual([
      "scoring-engine",
      "pricing-research",
      "sub-finder",
      "sub-verify",
      "outreach",
    ]);
    expect(mocks.enqueue.mock.calls[0][1]).toMatchObject({
      opportunityId: "band-1",
      bandDecisionOnly: true,
    });
    expect(mocks.enqueue.mock.calls[0][2]).toMatchObject({
      singletonKey: "band-decision:band-1",
    });
    expect(mocks.enqueue.mock.calls[3][1]).toMatchObject({
      opportunityId: "pursue-1",
      subcontractorId: "sub-1",
      trade: "roofing",
    });
    expect(result).toMatchObject({
      bandQueued: 1,
      sourcingQueued: 1,
      verifyQueued: 1,
      outreachQueued: 1,
      queueFailures: 0,
    });
  });

  it("does not queue a quote request while outbound mail is paused", async () => {
    mocks.rules.mockResolvedValue({
      autonomous_review_decisions: true,
      rfq_outbound_enabled: false,
      work_execution: "sub",
    });
    const result = await recoverOpenPursuitGaps(["org-1"]);
    expect(mocks.enqueue.mock.calls.map((call) => call[0])).not.toContain("outreach");
    expect(result.outreachQueued).toBe(0);
  });

  it("alerts once when verification is waiting and sub-verify has not run", async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("pipeline-stall-counts")) {
        return { ...quietCounts, unverified: 18, verify_runs: 0 };
      }
      if (sql.includes("start_alert_at is null")) return { id: "incident-1" };
      if (sql.includes("from automation_incidents")) return null;
      return null;
    });
    const first = await recoverOpenPursuitGaps(["org-1"]);
    expect(first.alerted).toBe(1);
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Pursue work is waiting",
      text: expect.stringContaining("sub-verify"),
    }));

    mocks.alert.mockClear();
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("pipeline-stall-counts")) {
        return { ...quietCounts, unverified: 18, verify_runs: 0 };
      }
      if (sql.includes("from automation_incidents")) return { id: "incident-1" };
      if (sql.includes("start_alert_at is null")) return null;
      return null;
    });
    const second = await recoverOpenPursuitGaps(["org-1"]);
    expect(second.alerted).toBe(0);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("does not alert again when a cleared stall flaps back inside the cooldown", async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("pipeline-stall-counts")) {
        return { ...quietCounts, unverified: 18, verify_runs: 0 };
      }
      if (sql.includes("from automation_incidents")) {
        return {
          id: "incident-1",
          state: "recovered",
          start_alert_at: new Date().toISOString(),
          end_alert_at: new Date().toISOString(),
        };
      }
      return null;
    });
    const result = await recoverOpenPursuitGaps(["org-1"]);
    expect(result.alerted).toBe(0);
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.openIncident).not.toHaveBeenCalled();
  });

  it("excludes parked items, finished empty searches, and unverified emails", async () => {
    await recoverOpenPursuitGaps(["org-1"]);
    const sql = mocks.query.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("human_action_required, false) is not true");
    expect(sql).toContain("status in ('ok', 'skipped')");
    expect(sql).toContain("band-decision-waiting");
    expect(sql).toContain("created_at desc");
    expect(sql).not.toContain("order by updated_at asc");
    expect(sql).not.toContain("email_unverified");
    expect(sql).toContain("outreach_state in ('pending', 'draft')");
    const counts = mocks.queryOne.mock.calls.map((call) => String(call[0])).join("\n");
    expect(counts).toContain("human_action_required, false) is not true");
    expect(counts).not.toContain("email_unverified");
  });

  it("does not queue a sub-finder that already finished without a pairing", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pursue-source-candidates")) {
        return [{ id: "pursue-1", finder_finished: true, pricing_finished: false }];
      }
      return [];
    });
    const result = await recoverOpenPursuitGaps(["org-1"]);
    expect(mocks.enqueue.mock.calls.map((call) => call[0])).toEqual(["pricing-research"]);
    expect(result.sourcingQueued).toBe(1);
  });

  it("waits out the backoff and parks the item once the cap is hit", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pursue-verify-candidates")) {
        return [{
          opportunity_id: "pursue-1",
          subcontractor_id: "sub-1",
          trade: "roofing",
          attempts: 1,
          last_attempt_at: new Date().toISOString(),
          finished: false,
        }];
      }
      if (sql.includes("band-backfill-capped")) return [{ id: "capped-1", attempts: 3 }];
      if (sql.includes("park-human-action")) return [{ id: "capped-1" }];
      return [];
    });
    const first = await recoverOpenPursuitGaps(["org-1"]);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(first.parked).toBe(1);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({
      subject: "A pursue step needs a person",
      text: expect.stringContaining("capped-1"),
    }));

    mocks.alert.mockClear();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("band-backfill-capped")) return [{ id: "capped-1", attempts: 3 }];
      if (sql.includes("park-human-action")) return [];
      return [];
    });
    const second = await recoverOpenPursuitGaps(["org-1"]);
    expect(second.parked).toBe(0);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("does not queue a step that is already running from an overlapping sweep", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("handoff-in-flight")) {
        return [
          { agent: "sub-finder", opportunity_id: "pursue-1" },
          { agent: "sub-verify", opportunity_id: "pursue-1" },
        ];
      }
      if (sql.includes("pursue-source-candidates")) return [{ id: "pursue-1" }];
      if (sql.includes("pursue-verify-candidates")) {
        return [
          { opportunity_id: "pursue-1", subcontractor_id: "sub-1", trade: "roofing" },
          { opportunity_id: "pursue-1", subcontractor_id: "sub-1", trade: "roofing" },
        ];
      }
      return [];
    });
    const result = await recoverOpenPursuitGaps(["org-1"]);
    expect(mocks.enqueue.mock.calls.map((call) => call[0])).toEqual(["pricing-research"]);
    expect(result.verifyQueued).toBe(0);
    expect(result.sourcingQueued).toBe(1);
  });
});

describe("continuation sweep ownership", () => {
  it("never counts a lease wait as an attempt, so a restart mid-call cannot park a record", () => {
    const src = readFileSync("lib/domain/pursuit-recovery-run.ts", "utf8");
    const exclusion = "l.status = 'error' and coalesce(l.action, '') <> 'completion-held'";
    const counts = src.match(/count\(\*\) filter \(where l\.status = 'error'[^\n]*/g) ?? [];
    expect(counts.length).toBeGreaterThanOrEqual(4);
    for (const count of counts) expect(count).toContain(exclusion);
    const lastAttempts = src.match(/max\(l\.created_at\) filter \(where l\.status = 'error'[^\n]*/g) ?? [];
    expect(lastAttempts.length).toBeGreaterThanOrEqual(3);
    for (const last of lastAttempts) expect(last).toContain(exclusion);
  });

  it("is not hung off scoring recovery or the provider probe", () => {
    expect(readFileSync("lib/agents/maintenance.ts", "utf8")).not.toContain("recoverOpenPursuitGaps");
    expect(readFileSync("lib/agents/provider-recovery-probe.ts", "utf8")).not.toContain("recoverOpenPursuitGaps");
    expect(readFileSync("lib/agents/pursuit-continuation-sweep.ts", "utf8")).toContain("recoverOpenPursuitGaps");
  });
});
