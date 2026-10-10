import { describe, expect, it } from "vitest";
import { assessAutomation, classifyFailure } from "@/lib/domain/automation-health";
const now = new Date("2026-09-09T12:00:00Z");
const beating = { paused: false, heartbeatAt: now, phase: "ready", configured: true, now };

describe("active blockers and verified history", () => {
  it("routes Google authorization failures to mailbox recovery", () => {
    expect(classifyFailure("Gmail 401 unauthorized")).toBe("integration_auth");
    expect(classifyFailure("invalid_grant: refresh token revoked")).toBe("integration_auth");
    expect(classifyFailure("No API key configured")).toBe("not_configured");
    expect(classifyFailure("Gmail fetch failed: network timeout")).toBe("network");
    expect(classifyFailure("Anthropic API key revoked")).toBe("provider_auth");
    expect(classifyFailure("Analysis confidence is too low")).toBe("unknown");
    expect(classifyFailure("database unreachable")).toBe("database");
    expect(classifyFailure("Outbound network unreachable")).toBe("network");
  });
  it("does not reopen a verified recovery from the same historical errors", () => {
    const result = assessAutomation({ ...beating, windowRuns: 5, windowErrors: 1,
      recoveredThrough: { provider_credit: "2026-09-09T11:00:00Z" },
      runs: [{ agent: "scoring", status: "error", error: "credit balance too low", startedAt: "2026-09-09T10:00:00Z" }],
    });
    expect(result.incidents).toEqual([]);
    expect(result.state).not.toBe("blocked");
    expect(result.errors24h).toBe(1); // audit history is not deleted
  });
  it("keeps later failures and unrelated causes active", () => {
    const result = assessAutomation({ ...beating,
      recoveredThrough: { provider_credit: "2026-09-09T11:00:00Z" },
      runs: [
        { agent: "scoring", status: "error", error: "credit balance too low", startedAt: "2026-09-09T11:30:00Z" },
        { agent: "outreach", status: "error", error: "gmail 401", startedAt: "2026-09-09T10:30:00Z" },
      ],
    });
    expect(result.state).toBe("blocked");
    expect(result.incidents.map(i => i.cause).sort()).toEqual(["integration_auth", "provider_credit"]);
  });
  it("does not call an unobserved worker healthy", () => {
    const result = assessAutomation({ ...beating, heartbeatAt: null, runs: [] });
    expect(result.state).toBe("blocked");
    expect(result.headline).toContain("not checked in");
  });
  it("reports the platform pause even when this account switch is on", () => {
    const result = assessAutomation({ ...beating, platformPaused: true, runs: [] });
    expect(result.state).toBe("paused");
    expect(result.detail).toContain("whole platform");
  });

  it("keeps a current provider refusal blocked after errors age out, without inventing failed events", () => {
    const result = assessAutomation({ ...beating, windowRuns: 5, windowErrors: 0,
      runs: [{ agent: "opportunity-monitor", status: "ok", startedAt: now }],
      providerHolds: [{ provider: "OpenAI", tier: "routine", reason: "The OpenAI account has insufficient credit." }],
    });
    expect(result.state).toBe("blocked");
    expect(result.errors24h).toBe(0);
    expect(result.failureRate).toBe(0);
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]).toMatchObject({ cause: "provider_credit", failures: 0, currentProviderHold: true });
    expect(result.incidents[0].spec.repairHref).toBe("/settings/integrations#openai");
  });

  it("does not let an old recovery marker clear current route evidence or double-count it", () => {
    const result = assessAutomation({ ...beating, windowRuns: 5, windowErrors: 1,
      recoveredThrough: { provider_credit: "2026-09-09T11:00:00Z" },
      runs: [{ agent: "analyst", status: "error", error: "OpenAI insufficient credit", startedAt: "2026-09-09T10:00:00Z" }],
      providerHolds: [
        { provider: "OpenAI", tier: "routine", reason: "OpenAI insufficient credit" },
        { provider: "OpenAI", tier: "complex", reason: "OpenAI insufficient credit" },
      ],
    });
    expect(result.state).toBe("blocked");
    expect(result.errors24h).toBe(1);
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].failures).toBe(0);
    expect(result.incidents[0].affectedWorkflows).toHaveLength(2);
  });

  it("requires reconciliation of an unresolved provider attempt even without recent failures", () => {
    const result = assessAutomation({ ...beating, runs: [], providerHolds: [{
      provider: "OpenAI", tier: "routine",
      reason: "A provider request is in progress or has an unresolved outcome. Recovery requires reconciliation if its worker stopped.",
    }] });
    expect(result.state).toBe("blocked");
    expect(result.incidents[0].cause).toBe("completion_reconciliation");
    expect(result.errors24h).toBe(0);
  });
});
