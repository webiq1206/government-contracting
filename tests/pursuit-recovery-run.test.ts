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
});
