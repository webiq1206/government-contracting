import { describe, expect, it } from "vitest";
import {
  GENERATED_NOTE,
  plannedComplianceItems,
  plannedMilestones,
} from "@/lib/domain/contract-startup";

describe("what an award creates", () => {
  const dated = { startDate: "2026-09-01", endDate: "2027-08-31" };

  it("dates each obligation off the contract, not off today", () => {
    /*
     * A made-up deadline is one people learn to ignore, and once they have
     * learned that they ignore the real ones too.
     */
    const m = plannedMilestones(dated);
    expect(m.find((x) => x.key === "kickoff")?.dueAt).toBe("2026-09-15");
    expect(m.find((x) => x.key === "insurance_on_file")?.dueAt).toBe("2026-09-08");
    expect(m.find((x) => x.key === "first_invoice")?.dueAt).toBe("2026-10-01");
    expect(m.find((x) => x.key === "closeout_package")?.dueAt).toBe("2027-09-14");
  });

  it("still creates the obligation when there is no date to hang it on", () => {
    // The duty exists whether or not anybody has typed the dates, and "no
    // date on file" is a better answer than the obligation not existing.
    const m = plannedMilestones({});
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((x) => x.dueAt === null)).toBe(true);
  });

  it("keeps the list short enough to be read", () => {
    // A list of twenty generated tasks is one somebody deletes wholesale.
    expect(plannedMilestones(dated).length).toBeLessThanOrEqual(6);
  });

  it("adds the bond only when the award requires one", () => {
    expect(plannedMilestones(dated).some((m) => m.key === "bond_in_place")).toBe(false);
    const bonded = plannedMilestones({ ...dated, bondRequired: true });
    expect(bonded.some((m) => m.key === "bond_in_place")).toBe(true);
    // Before the kickoff in the list: a bonded award cannot start without it.
    expect(bonded.findIndex((m) => m.key === "bond_in_place")).toBeLessThan(
      bonded.findIndex((m) => m.key === "first_invoice")
    );
  });

  it("adds the subcontract agreement only when there is a subcontractor", () => {
    expect(plannedMilestones(dated).some((m) => m.key === "sub_agreement")).toBe(false);
    expect(
      plannedMilestones({ ...dated, hasSubcontractor: true }).some((m) => m.key === "sub_agreement")
    ).toBe(true);
  });

  it("says why each one exists", () => {
    for (const m of plannedMilestones({ ...dated, bondRequired: true, hasSubcontractor: true })) {
      expect(m.detail.trim().length).toBeGreaterThan(20);
      expect(m.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("marks generated items so a person can tell them from their own", () => {
    expect(GENERATED_NOTE).toMatch(/Change or remove it/);
  });
});

describe("the compliance rows an award creates", () => {
  it("writes the contract_deadline category the page was built for", () => {
    /*
     * The compliance page has always known how to display this category and
     * nothing has ever written one.
     */
    const items = plannedComplianceItems({ startDate: "2026-09-01", endDate: "2027-08-31" });
    expect(items.some((i) => i.category === "contract_deadline")).toBe(true);
    expect(items.some((i) => i.category === "cpars")).toBe(true);
  });

  it("gives CPARS a long window, because the cost lands on later bids", () => {
    const items = plannedComplianceItems({ endDate: "2027-08-31" });
    const cpars = items.find((i) => i.key === "cpars")!;
    expect(cpars.dueAt).toBe("2027-12-29");
    expect(cpars.windowDays).toBeGreaterThanOrEqual(60);
  });

  it("creates nothing dated when the contract has no dates", () => {
    expect(plannedComplianceItems({})).toEqual([]);
  });

  it("leaves the insurance item undated rather than inventing an expiry", () => {
    const items = plannedComplianceItems({ startDate: "2026-09-01" });
    const ins = items.find((i) => i.key === "insurance_for_contract")!;
    // Nobody has read the contract for its expiry, so there is no date to
    // count down to and none is made up.
    expect(ins.dueAt).toBeNull();
  });
});
