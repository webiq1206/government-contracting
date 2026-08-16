import { describe, it, expect } from "vitest";
import { planTaskList, assemblePlan, type PlanStep } from "@/lib/domain/step-plan";

const step = (over: Partial<PlanStep> & { key: string; n: number }): PlanStep => ({
  title: `Step ${over.n}`,
  plain: "",
  status: "upcoming",
  owner: "brost",
  ...over,
});

describe("plan task list", () => {
  it("groups live work by who is holding it", () => {
    const plan = assemblePlan(
      [
        step({ key: "a", n: 1, status: "done" }),
        step({ key: "b", n: 2, status: "current", owner: "brost" }),
        step({ key: "c", n: 3, status: "current", owner: "you" }),
        step({ key: "d", n: 4, status: "current", owner: "subs" }),
        step({ key: "e", n: 5 }),
      ],
      { activeKey: "c" }
    );
    const t = planTaskList(plan);
    expect(t.running.map((s) => s.key)).toEqual(["b"]);
    expect(t.needsYou.map((s) => s.key)).toEqual(["c"]);
    expect(t.waitingOn.map((s) => s.key)).toEqual(["d"]);
    expect(t.idle).toBe(false);
  });

  it("counts a blocked step as needing you whatever its nominal owner", () => {
    const plan = assemblePlan(
      [
        step({
          key: "auto",
          n: 1,
          status: "blocked",
          owner: "brost",
          blockers: [{ what: "Email could not send.", how: "Fix it." }],
        }),
        step({ key: "b", n: 2, status: "current", owner: "you" }),
      ],
      { activeKey: "b" }
    );
    const t = planTaskList(plan);
    expect(t.needsYou.map((s) => s.key)).toEqual(["auto", "b"]);
    expect(t.running).toHaveLength(0);
  });

  it("lists the next few upcoming steps so nothing is a surprise", () => {
    const plan = assemblePlan(
      [
        step({ key: "a", n: 1, status: "done" }),
        step({ key: "b", n: 2, status: "current", owner: "you" }),
        step({ key: "c", n: 3 }),
        step({ key: "d", n: 4 }),
        step({ key: "e", n: 5 }),
        step({ key: "f", n: 6 }),
      ],
      { activeKey: "b" }
    );
    expect(planTaskList(plan).next.map((s) => s.key)).toEqual(["c", "d", "e"]);
    expect(planTaskList(plan, { nextCount: 1 }).next.map((s) => s.key)).toEqual(["c"]);
  });

  it("reports idle when every step is done", () => {
    const plan = assemblePlan([
      step({ key: "a", n: 1, status: "done" }),
      step({ key: "b", n: 2, status: "done" }),
    ]);
    const t = planTaskList(plan);
    expect(t.idle).toBe(true);
    expect(t.next).toHaveLength(0);
  });
});
