import { describe, it, expect } from "vitest";
import { buildContractPlan, type ContractPlanInput } from "@/lib/domain/contract-plan";

const NOW = "2026-08-16T12:00:00Z";

function input(over: Partial<ContractPlanInput> = {}): ContractPlanInput {
  return {
    completed: false,
    hasBackupSub: false,
    milestones: [],
    coordinationCount: 0,
    nonSsPct: 20,
    cparsStatus: "not_started",
    cparsDue: null,
    now: NOW,
    ...over,
  };
}

describe("contract plan", () => {
  it("starts a fresh contract on the backup-sub step, blocked", () => {
    const plan = buildContractPlan(input());
    expect(plan.total).toBe(7);
    expect(plan.active?.key).toBe("backup");
    expect(plan.active?.status).toBe("blocked");
    expect(plan.active?.blockers?.[0].href).toBe("/subs");
  });

  it("counts milestones and flags the overdue ones", () => {
    const plan = buildContractPlan(
      input({
        hasBackupSub: true,
        milestones: [
          { name: "Mobilize", due: "2026-07-01", status: "complete" },
          { name: "Rough-in", due: "2026-08-01", status: "in_progress" },
          { name: "Final", due: "2026-10-01", status: "not_started" },
        ],
      })
    );
    const ms = plan.steps.find((s) => s.key === "milestones")!;
    expect(plan.active?.key).toBe("milestones");
    expect(ms.status).toBe("blocked");
    expect(ms.detail).toBe("1 of 3 complete, 1 overdue");
    expect(ms.blockers?.[0].what).toBe('"Rough-in" is past its due date.');
  });

  it("warns inside the spend band and hard-blocks at the cap", () => {
    const warn = buildContractPlan(input({ hasBackupSub: true, nonSsPct: 46 }));
    const warnCap = warn.steps.find((s) => s.key === "cap")!;
    expect(warnCap.status).toBe("blocked");
    expect(warnCap.blockers?.[0].what).toMatch(/warning band/);

    const cap = buildContractPlan(input({ hasBackupSub: true, nonSsPct: 49.5 }));
    expect(cap.steps.find((s) => s.key === "cap")!.blockers?.[0].how).toMatch(
      /Stop adding/
    );
  });

  it("keeps coordination current until something is logged", () => {
    const plan = buildContractPlan(
      input({
        hasBackupSub: true,
        milestones: [{ name: "Mobilize", due: "2026-09-01", status: "complete" }],
      })
    );
    expect(plan.active?.key).toBe("coordination");
    expect(plan.active?.status).toBe("current");
    expect(plan.active?.detail).toBe("Nothing logged yet");
  });

  it("closes out a completed contract without blocking on leftovers", () => {
    const plan = buildContractPlan(
      input({
        completed: true,
        hasBackupSub: true,
        milestones: [{ name: "All work", due: "2026-06-01", status: "complete" }],
        coordinationCount: 4,
        cparsStatus: "in_progress",
      })
    );
    expect(plan.active).toBeUndefined();
    expect(plan.steps.find((s) => s.key === "closeout")?.status).toBe("done");
    expect(plan.steps.every((s) => s.status !== "blocked")).toBe(true);
    const cpars = plan.steps.find((s) => s.key === "cpars")!;
    expect(cpars.status).toBe("upcoming");
  });

  it("finishes the whole plan when everything is done", () => {
    const plan = buildContractPlan(
      input({
        completed: true,
        hasBackupSub: true,
        milestones: [{ name: "All work", due: "2026-06-01", status: "complete" }],
        coordinationCount: 4,
        nonSsPct: 10,
        cparsStatus: "complete",
      })
    );
    expect(plan.done).toBe(7);
    expect(plan.headline).toBe("All 7 steps are done");
  });
});
