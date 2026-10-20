import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_DISCOVERED_FOR_ALERT,
  outcomeStallEligible,
  outcomeStallText,
  type OutcomeCounts,
} from "../lib/domain/outcome-watch";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), enqueue: vi.fn(), log: vi.fn(), rules: vi.fn(),
  profile: vi.fn(), alert: vi.fn(), openIncident: vi.fn(), advance: vi.fn(),
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
vi.mock("../lib/tenant-context", () => ({ runWithOrg: async (_orgId: string, fn: () => unknown) => fn() }));

import { recoverOpenPursuitGaps } from "../lib/domain/pursuit-recovery-run";

const healthy: OutcomeCounts = {
  discovered: 206, sourced: 11, parkedForPerson: 0, emailableWaiting: 15, rfqSent: 25, outboundPaused: false,
};

describe("the outcome alert judges results, not whether jobs ran", () => {
  it("fires on the October 2026 shape: many arrivals, nothing sourced, records parked for a person", () => {
    const outage = { ...healthy, sourced: 0, parkedForPerson: 98, emailableWaiting: 0, rfqSent: 0 };
    expect(outcomeStallEligible(outage)).toBe(true);
    expect(outcomeStallText(outage)).toContain("206 new opportunities");
    expect(outcomeStallText(outage)).toContain("98 open record(s) are held");
  });

  it("fires when verified emails wait and nothing was sent, even though every job succeeded", () => {
    const held = { ...healthy, rfqSent: 0 };
    expect(outcomeStallEligible(held)).toBe(true);
    expect(outcomeStallText(held)).toContain("15 subcontractor(s) with a verified email");
  });

  it("stays quiet when work flows, on a quiet weekend, and while outbound mail is paused on purpose", () => {
    expect(outcomeStallEligible(healthy)).toBe(false);
    expect(outcomeStallEligible({ ...healthy, discovered: MIN_DISCOVERED_FOR_ALERT - 1, sourced: 0 })).toBe(false);
    expect(outcomeStallEligible({ ...healthy, rfqSent: 0, outboundPaused: true })).toBe(false);
    expect(outcomeStallEligible({ ...healthy, emailableWaiting: 0, rfqSent: 0 })).toBe(false);
  });
});

describe("the continuation sweep delivers the outcome alert once and announces recovery", () => {
  const stalled = { discovered: 206, sourced: 0, parked: 98, emailable_waiting: 0, rfq_sent: 0 };
  let counts: Record<string, number>;
  let incident: Record<string, unknown> | null;
  let claimable: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rules.mockResolvedValue({ autonomous_review_decisions: true, rfq_outbound_enabled: true, work_execution: "sub" });
    mocks.profile.mockResolvedValue({ decision_thresholds: { pursue_min_score: 70, review_min_score: 50 } });
    mocks.alert.mockResolvedValue("email");
    mocks.openIncident.mockResolvedValue({ id: "outcome-incident" });
    mocks.query.mockResolvedValue([]);
    counts = stalled;
    incident = null;
    claimable = true;
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("outcome-stall-counts")) return counts;
      if (sql.includes("outcome-stall-incident")) return incident;
      if (sql.includes("start_alert_at is null") || sql.includes("end_alert_at is null")) return claimable ? { id: "outcome-incident" } : null;
      return null;
    });
  });

  it("alerts once while the stall lasts", async () => {
    const first = await recoverOpenPursuitGaps(["org-1"]);
    expect(first.alerted).toBe(1);
    expect(mocks.openIncident).toHaveBeenCalledWith(expect.objectContaining({ cause: "pursuit_outcome_stall", severity: "blocking" }));
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Opportunities are arriving but no quote requests are going out",
      text: expect.stringContaining("none reached subcontractor sourcing"),
    }));

    mocks.alert.mockClear();
    incident = { id: "outcome-incident", state: "open", start_alert_at: new Date().toISOString(), end_alert_at: null };
    const second = await recoverOpenPursuitGaps(["org-1"]);
    expect(second.alerted).toBe(0);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("says so when quote requests are going out again", async () => {
    incident = { id: "outcome-incident", state: "open", start_alert_at: new Date(Date.now() - 86_400_000).toISOString(), end_alert_at: null };
    counts = { discovered: 206, sourced: 11, parked: 0, emailable_waiting: 3, rfq_sent: 25 };
    const result = await recoverOpenPursuitGaps(["org-1"]);
    expect(result.resolved).toBe(1);
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({ subject: "Quote requests are going out again" }));
  });
});
