import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  backoffAfterFailure,
  eligibleForRescore,
  probeIsDue,
  PROBE_BACKOFF_MS,
  rescoreKey,
} from "@/lib/domain/provider-recovery";
import { recoverOrg, type ProviderHold, type RecoveryProbeDeps } from "@/lib/domain/provider-recovery-run";
import { deliverOutageAlert } from "@/lib/outage-alert";

const NOW = new Date("2026-10-16T17:11:00.000Z");

function hold(over: Partial<ProviderHold> = {}): ProviderHold {
  return {
    provider: "OpenAI",
    refusalReason: "You exceeded your current quota.",
    attemptPending: false,
    nextProbeAt: null,
    failureCount: 0,
    ...over,
  };
}

function deps(over: Partial<RecoveryProbeDeps> & { rows?: ProviderHold[] } = {}): RecoveryProbeDeps & {
  alerts: { kind: string; text: string }[];
  queued: string[];
} {
  const alerts: { kind: string; text: string }[] = [];
  const queued: string[] = [];
  const claimed = new Set<string>();
  const rows = over.rows ?? [hold()];
  const { rows: _rows, ...rest } = over;
  const base: RecoveryProbeDeps = {
    now: () => NOW,
    holds: async () => rows,
    probe: async () => ({ ok: true, detail: "ready" }),
    recordFailure: async () => undefined,
    clearSchedule: async () => undefined,
    openIncident: async () => ({ id: "inc-1" }),
    claimAlert: async (_org, id, kind) => {
      const key = `${id}:${kind}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    sendAlert: async (alert) => {
      alerts.push({ kind: alert.kind, text: alert.text });
    },
    candidates: async () => [],
    enqueueRescore: async (_org, _id, key) => {
      if (queued.includes(key)) return false;
      queued.push(key);
      return true;
    },
    markRecovered: async () => undefined,
    leadBusinessDays: 5,
    ...rest,
  };
  return Object.assign(base, { alerts, queued });
}

describe("probe schedule", () => {
  it("backs off 10 minutes, 30 minutes, 1 hour, then 6 hours", () => {
    expect(backoffAfterFailure(1)).toBe(PROBE_BACKOFF_MS[0]);
    expect(backoffAfterFailure(2)).toBe(30 * 60_000);
    expect(backoffAfterFailure(3)).toBe(60 * 60_000);
    expect(backoffAfterFailure(4)).toBe(6 * 60 * 60_000);
    expect(backoffAfterFailure(9)).toBe(6 * 60 * 60_000);
  });

  it("does not probe while an attempt is pending or the backoff window is open", () => {
    expect(probeIsDue({
      refusalHeld: true,
      attemptPending: true,
      nextProbeAt: null,
      now: NOW,
    })).toBe(false);
    expect(probeIsDue({
      refusalHeld: true,
      attemptPending: false,
      nextProbeAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    })).toBe(false);
    expect(probeIsDue({
      refusalHeld: true,
      attemptPending: false,
      nextProbeAt: null,
      now: NOW,
    })).toBe(true);
  });
});

describe("rescore filter", () => {
  const far = new Date("2026-11-02T17:11:00.000Z").toISOString();
  const soon = new Date(NOW.getTime() + 12 * 60 * 60_000).toISOString();

  it("keeps an open incomplete review item whose deadline is outside the lead time", () => {
    expect(eligibleForRescore({
      id: "opp-1",
      tier: "review",
      status: "open",
      stage: "scoring",
      riskFlags: ["incomplete_scoring"],
      deadline: far,
    }, NOW)).toBe(true);
  });

  it("skips a close deadline, a missing flag, a later stage, and a closed item", () => {
    const base = {
      id: "opp-1",
      tier: "review",
      status: "open",
      stage: "scoring",
      riskFlags: ["incomplete_scoring"],
      deadline: far,
    };
    expect(eligibleForRescore({ ...base, deadline: soon }, NOW)).toBe(false);
    expect(eligibleForRescore({ ...base, riskFlags: [] }, NOW)).toBe(false);
    expect(eligibleForRescore({ ...base, stage: "outreach" }, NOW)).toBe(false);
    expect(eligibleForRescore({ ...base, status: "archived" }, NOW)).toBe(false);
    expect(eligibleForRescore({ ...base, tier: "pursue" }, NOW)).toBe(false);
  });

  it("uses one singleton key per opportunity and incident", () => {
    expect(rescoreKey("opp-1", "inc-1")).toBe("rescore:opp-1:inc-1");
    expect(rescoreKey("opp-1", "inc-1")).toBe(rescoreKey("opp-1", "inc-1"));
  });
});

describe("recoverOrg", () => {
  it("probes once and clears the schedule only after the probe answers", async () => {
    const order: string[] = [];
    const harness = deps({
      probe: async () => {
        order.push("probe");
        return { ok: true, detail: "ready" };
      },
      clearSchedule: async () => {
        order.push("clear");
      },
    });
    await recoverOrg("org-1", harness);
    expect(order).toEqual(["probe", "clear"]);
    expect(harness.alerts.map((alert) => alert.kind)).toEqual(["start", "end"]);
  });

  it("does not probe while an attempt is pending", async () => {
    let probes = 0;
    const harness = deps({
      rows: [hold({ attemptPending: true })],
      probe: async () => {
        probes += 1;
        return { ok: true, detail: "ready" };
      },
    });
    const result = await recoverOrg("org-1", harness);
    expect(probes).toBe(0);
    expect(result.skippedPending).toEqual(["OpenAI"]);
    expect(result.endAlerts).toBe(0);
    expect(result.startAlerts).toBe(1);
  });

  it("waits out the backoff and does not send a second start alert", async () => {
    let probes = 0;
    const claimed = new Set<string>();
    const alerts: string[] = [];
    const shared: Partial<RecoveryProbeDeps> = {
      probe: async () => {
        probes += 1;
        return { ok: false, detail: "still refused" };
      },
      claimAlert: async (_org, id, kind) => {
        const key = `${id}:${kind}`;
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      sendAlert: async (alert) => {
        alerts.push(alert.kind);
      },
    };
    await recoverOrg("org-1", deps({ ...shared, rows: [hold()] }));
    await recoverOrg("org-1", deps({
      ...shared,
      rows: [hold({ failureCount: 1, nextProbeAt: new Date(NOW.getTime() + 10 * 60_000) })],
    }));
    expect(probes).toBe(1);
    expect(alerts).toEqual(["start"]);
  });

  it("re-queues only eligible rows, once, and sends one recovery alert with the count", async () => {
    const far = new Date("2026-11-02T17:11:00.000Z").toISOString();
    const soon = new Date(NOW.getTime() + 2 * 60 * 60_000).toISOString();
    const rows = [
      { id: "keep", tier: "review", status: "open", stage: "scoring", riskFlags: ["incomplete_scoring"], deadline: far },
      { id: "soon", tier: "review", status: "open", stage: "scoring", riskFlags: ["incomplete_scoring"], deadline: soon },
      { id: "scored", tier: "review", status: "open", stage: "scoring", riskFlags: ["value_over_max"], deadline: far },
      { id: "outreach", tier: "review", status: "open", stage: "outreach", riskFlags: ["incomplete_scoring"], deadline: far },
    ];
    const harness = deps({ candidates: async () => rows });
    const first = await recoverOrg("org-1", harness);
    const second = await recoverOrg("org-1", harness);
    expect(first.requeued).toBe(1);
    expect(second.requeued).toBe(0);
    expect(harness.queued).toEqual(["rescore:keep:inc-1"]);
    expect(harness.alerts.filter((alert) => alert.kind === "end")).toHaveLength(1);
    expect(harness.alerts.find((alert) => alert.kind === "end")?.text).toContain("1 incomplete");
    expect(harness.alerts.filter((alert) => alert.kind === "start")).toHaveLength(1);
  });
});

describe("the probe uses the existing recovery call", () => {
  const src = readFileSync("lib/agents/provider-recovery-probe.ts", "utf8");

  it("calls probeProviderRecovery and does not clear the refusal itself", () => {
    expect(src).toContain("probeProviderRecovery");
    expect(src).not.toMatch(/set\s+refusal_reason/i);
    expect(src).not.toMatch(/refusal_reason\s*=/);
    expect(src).toContain('worksWithoutClaude: true');
  });

  it("is scheduled every 10 minutes", () => {
    const registry = readFileSync("lib/agents/registry.ts", "utf8");
    expect(registry).toContain("providerRecoveryProbe");
    expect(registry).toMatch(/providerRecoveryProbe, cron: "\*\/10 \* \* \* \*"/);
  });
});

vi.mock("../lib/integrations/system-mail", () => ({
  systemMail: { send: vi.fn(async () => ({ messageId: "mail-1" })) },
}));
vi.mock("../lib/integrations/twilio", () => ({
  sms: { alert: vi.fn(async () => ({ sid: "sms-1" })) },
}));
vi.mock("../lib/config", () => ({
  config: { systemMail: { digestTo: "ops@example.test" } },
}));

describe("outage alert channel", () => {
  it("sends one email and does not also text", async () => {
    const mail = await import("../lib/integrations/system-mail");
    const twilio = await import("../lib/integrations/twilio");
    const sent = await deliverOutageAlert({ subject: "OpenAI stopped", text: "Credit is exhausted." });
    expect(sent).toBe("email");
    expect(mail.systemMail.send).toHaveBeenCalledTimes(1);
    expect(twilio.sms.alert).not.toHaveBeenCalled();
  });
});
