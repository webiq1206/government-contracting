/**
 * The trial sweep may not record a warning nobody received.
 *
 * The send ended in `.catch(() => undefined)` and the log said "Warned
 * {email}" regardless. That log row is also the dedupe marker: the next sweep
 * skips an org that already has a `trial-warning-3d` row within 36 hours. So
 * one transient mail failure permanently lost that customer's three-day
 * notice, and the audit trail said they had been told. They would find the
 * account locked with no warning, which the file's own header calls the thing
 * that makes people leave.
 *
 * A failed send is now logged under `trial-warning-3d-unsent`, which the
 * dedupe does not match, so the next sweep tries again while the threshold is
 * still in the past.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const logged: { action: string; level: string; message: string }[] = [];
let sendBehaviour: () => Promise<void> = async () => {};

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("update organizations")) return [];
    // The dedupe lookup: nothing warned yet.
    if (sql.includes("count(*)::int as n")) return [{ n: 0 }];
    if (sql.includes("select o.id, o.name")) {
      return [
        {
          id: "org-1",
          name: "Rivera Contracting",
          trial_ends_at: "2026-09-01",
          owner_email: "owner@rivera.test",
          days_left: 3,
        },
      ];
    }
    return [];
  }),
}));
vi.mock("@/lib/logger", () => ({
  logAgent: vi.fn(async (e: { action: string; level: string; message: string }) => {
    logged.push(e);
  }),
}));
vi.mock("@/lib/integrations/system-mail", () => ({
  systemMail: {
    enabled: async () => true,
    send: async () => sendBehaviour(),
  },
}));

const { trialSweep } = await import("@/lib/agents/trial-sweep");

beforeEach(() => {
  logged.length = 0;
  sendBehaviour = async () => {};
});

describe("a trial warning that could not be sent", () => {
  it("is not recorded under the action the dedupe matches", async () => {
    sendBehaviour = async () => {
      throw new Error("smtp refused");
    };
    await trialSweep.handler({ payload: {} } as never);
    const warn = logged.find((l) => l.action.startsWith("trial-warning"))!;
    expect(warn.action).toBe("trial-warning-3d-unsent");
    // This is the whole point: the marker the next sweep looks for is absent,
    // so the customer gets another chance at the notice.
    expect(warn.action).not.toBe("trial-warning-3d");
  });

  it("does not claim the customer was warned", async () => {
    sendBehaviour = async () => {
      throw new Error("smtp refused");
    };
    await trialSweep.handler({ payload: {} } as never);
    const warn = logged.find((l) => l.action.startsWith("trial-warning"))!;
    expect(warn.message).not.toContain("Warned owner@rivera.test");
    expect(warn.message).toContain("failed");
    expect(warn.message).toContain("smtp refused");
    expect(warn.level).toBe("warn");
  });

  it("is not counted in the run's warned total", async () => {
    sendBehaviour = async () => {
      throw new Error("smtp refused");
    };
    const r = await trialSweep.handler({ payload: {} } as never);
    expect(r.summary).toContain("0 warned");
  });

  it("records the ordinary case as sent, under the deduping action", async () => {
    const r = await trialSweep.handler({ payload: {} } as never);
    const warn = logged.find((l) => l.action.startsWith("trial-warning"))!;
    expect(warn.action).toBe("trial-warning-3d");
    expect(warn.message).toContain("Warned owner@rivera.test");
    expect(r.summary).toContain("1 warned");
  });
});
