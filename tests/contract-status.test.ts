/**
 * Which pile a contract belongs in.
 *
 * The page showed the two stored statuses and nothing else, which is enough to
 * file a contract and not enough to run one. The three views that were missing
 * are the ones an operator looks for, and two of them are derived rather than
 * stored -- deliberately, because a stored risk flag is a flag somebody has to
 * remember to clear, and the one nobody clears stops being believed.
 */
import { describe, it, expect } from "vitest";
import { contractView, contractRisks, contractsHeadline } from "@/lib/domain/contract-status";

const NOW = new Date("2026-08-26T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("contractView", () => {
  it("is starting soon when the work has not begun", () => {
    /*
     * The window that matters most and had no view at all: insurance
     * certificates, the subcontractor's paperwork and mobilisation all have to
     * be in hand BEFORE day one.
     */
    expect(
      contractView({ status: "active", startDate: days(14), endDate: days(200), now: NOW })
    ).toBe("starting_soon");
  });

  it("is active when running with nothing wrong", () => {
    expect(
      contractView({ status: "active", startDate: days(-30), endDate: days(200), now: NOW })
    ).toBe("active");
  });

  it("is at risk when a milestone is overdue", () => {
    expect(
      contractView({
        status: "active",
        startDate: days(-30),
        endDate: days(200),
        milestones: [{ name: "Rough-in", due: days(-5), status: "in_progress" }],
        now: NOW,
      })
    ).toBe("at_risk");
  });

  it("keeps a terminated contract out of completed", () => {
    // Filing a loss as "completed" makes every win rate and margin figure
    // quietly wrong, which is the kind of wrong nobody goes looking for.
    expect(contractView({ status: "terminated", now: NOW })).toBe("terminated");
    expect(contractView({ status: "lost", now: NOW })).toBe("terminated");
  });

  it("does not flag a finished contract for having finished", () => {
    expect(
      contractView({ status: "completed", startDate: days(-300), endDate: days(-10), now: NOW })
    ).toBe("completed");
  });

  it("treats a terminated contract as terminated whatever its dates say", () => {
    expect(
      contractView({ status: "terminated", startDate: days(30), endDate: days(200), now: NOW })
    ).toBe("terminated");
  });
});

describe("contractRisks", () => {
  it("says how overdue, not just that it is overdue", () => {
    const [risk] = contractRisks({
      status: "active",
      startDate: days(-30),
      endDate: days(200),
      milestones: [{ name: "Rough-in", due: days(-5), status: "pending" }],
      now: NOW,
    });
    expect(risk.detail).toContain("Rough-in");
    expect(risk.detail).toContain("5 days ago");
  });

  it("blocks at the subcontracting cap and only warns below it", () => {
    // Dates supplied deliberately: without them `no_dates` fires first and
    // this would be testing that instead, which is how a fixture ends up
    // asserting something other than its own name.
    const running = { status: "active", startDate: days(-30), endDate: days(200), now: NOW };

    const blocked = contractRisks({ ...running, nonSsSubPct: 49 });
    expect(blocked[0].kind).toBe("sub_spend_cap");
    expect(blocked[0].blocking).toBe(true);

    const warned = contractRisks({ ...running, nonSsSubPct: 46 });
    expect(warned[0].blocking).toBe(false);

    expect(contractRisks({ ...running, nonSsSubPct: 20 })).toEqual([]);
  });

  it("names the consequence of a late CPARS rather than just the date", () => {
    const [risk] = contractRisks({
      status: "active",
      startDate: days(-300),
      endDate: days(-10),
      cparsDueAt: days(-3),
      cparsStatus: "pending",
      now: NOW,
    }).filter((r) => r.kind === "cpars_overdue");
    expect(risk.detail).toMatch(/future bid/i);
  });

  it("does not flag a CPARS that has been submitted", () => {
    const risks = contractRisks({
      status: "active",
      startDate: days(-300),
      endDate: days(200),
      cparsDueAt: days(-30),
      cparsStatus: "submitted",
      now: NOW,
    });
    expect(risks.some((r) => r.kind === "cpars_overdue")).toBe(false);
  });

  it("says so when there are no dates at all rather than reporting nothing wrong", () => {
    // "Cannot monitor" rather than silence: a contract with no period of
    // performance is not a healthy contract, it is an unwatched one.
    const risks = contractRisks({ status: "active", now: NOW });
    expect(risks[0].kind).toBe("no_dates");
  });

  it("does not double-count a completed milestone", () => {
    const risks = contractRisks({
      status: "active",
      startDate: days(-30),
      endDate: days(200),
      milestones: [
        { name: "Done", due: days(-40), status: "complete" },
        { name: "Late", due: days(-2), status: "pending" },
      ],
      now: NOW,
    });
    expect(risks.filter((r) => r.kind === "milestone_overdue")).toHaveLength(1);
  });
});

describe("contractsHeadline", () => {
  const zero = { active: 0, starting_soon: 0, at_risk: 0, completed: 0, terminated: 0 };

  it("leads with what needs a person", () => {
    expect(contractsHeadline({ ...zero, at_risk: 2, active: 9 })).toBe("2 contracts need attention");
  });

  it("falls back through starting soon, then running", () => {
    expect(contractsHeadline({ ...zero, starting_soon: 1, active: 4 })).toBe("1 starting soon");
    expect(contractsHeadline({ ...zero, active: 4 })).toBe("4 running, nothing flagged");
  });

  it("does not say zero contracts need attention", () => {
    expect(contractsHeadline(zero)).toBe("No active contracts");
  });
});

// ---------------------------------------------------------------------------

import { buildContractPlan } from "@/lib/domain/contract-plan";

describe("buildContractPlan, CPARS date shape", () => {
  const base = {
    completed: false,
    hasBackupSub: true,
    milestones: [],
    coordinationCount: 0,
    nonSsPct: 10,
    cparsStatus: "pending",
    now: "2026-08-26T12:00:00Z",
  };

  it("accepts a Date, which is what the database actually returns", () => {
    /*
     * node-postgres hands back a Date for a timestamptz. The page cast it as
     * `string | null`, which TypeScript accepted and the runtime did not:
     * `.slice is not a function` took down the entire Contracts page for any
     * contract with a CPARS due date. No seeded contract had one, so it never
     * fired in development.
     */
    expect(() =>
      buildContractPlan({ ...base, cparsDue: new Date("2026-09-01T00:00:00Z") })
    ).not.toThrow();
    const plan = buildContractPlan({ ...base, cparsDue: new Date("2026-09-01T00:00:00Z") });
    expect(JSON.stringify(plan)).toContain("2026-09-01");
  });

  it("still accepts a string", () => {
    const plan = buildContractPlan({ ...base, cparsDue: "2026-09-01T00:00:00Z" });
    expect(JSON.stringify(plan)).toContain("2026-09-01");
  });

  it("does not throw on an unparseable value", () => {
    expect(() => buildContractPlan({ ...base, cparsDue: "not a date" })).not.toThrow();
  });

  it("says nothing about a due date when there is none", () => {
    const plan = buildContractPlan({ ...base, cparsDue: null });
    expect(JSON.stringify(plan)).not.toContain("due ");
  });
});
