import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  categoryStatuses,
  deliverySummary,
  type DeliveryFacts,
} from "@/lib/domain/notification-prefs";

function facts(over: Partial<DeliveryFacts> = {}): DeliveryFacts {
  return {
    isOperationsOrg: false,
    hasOperationsAddress: true,
    mailEnabled: true,
    ownerEmail: "owner@example.test",
    ...over,
  };
}

function byKey(f: DeliveryFacts, key: string) {
  return categoryStatuses(f).find((s) => s.key === key)!;
}

describe("categoryStatuses", () => {
  it("covers the eight categories the audit names", () => {
    expect(CATEGORIES.map((c) => c.key)).toEqual([
      "critical_account",
      "automation_incidents",
      "deadlines",
      "replies",
      "assignments",
      "compliance",
      "summaries",
      "informational",
    ]);
  });

  it("emails critical account alerts to the owner", () => {
    const s = byKey(facts(), "critical_account");
    expect(s.route).toBe("account_owner");
    expect(s.reachesAccount).toBe(true);
    expect(s.statement).toContain("owner@example.test");
  });

  it("refuses to let a critical alert be switched off, and says what silence costs", () => {
    const s = byKey(facts(), "critical_account");
    expect(s.canDisable).toBe(false);
    // "You cannot turn this off" is an instruction. This has to be a reason.
    expect(s.whyMandatory).toContain("locked mid-bid");
  });

  it("tells an ordinary account that compliance reminders are not emailed to it", () => {
    // The finding this module exists for: digests are gated on the operations
    // organization, so a customer whose subcontractor insurance lapses on a
    // live contract is told by nobody.
    const s = byKey(facts({ isOperationsOrg: false }), "compliance");
    expect(s.route).toBe("in_app_only");
    expect(s.reachesAccount).toBe(false);
    expect(s.statement).toContain("only seen by somebody who opens the page");
  });

  it("says where the operations digest actually goes", () => {
    const s = byKey(facts({ isOperationsOrg: true }), "compliance");
    expect(s.route).toBe("operations_address");
    expect(s.statement).toContain("not to the account");
  });

  it("does not claim a digest is sent when no address is configured", () => {
    const s = byKey(facts({ isOperationsOrg: true, hasOperationsAddress: false }), "summaries");
    expect(s.route).toBe("in_app_only");
  });

  it("does not claim any email is sent when mail is switched off entirely", () => {
    const all = categoryStatuses(facts({ mailEnabled: false, isOperationsOrg: true }));
    expect(all.some((s) => s.reachesAccount)).toBe(false);
    expect(all.some((s) => s.route === "operations_address")).toBe(false);
  });

  it("does not claim email reaches an account with nobody on it", () => {
    expect(byKey(facts({ ownerEmail: null }), "critical_account").route).toBe("in_app_only");
  });

  it("flags a mandatory alert that is not being delivered, rather than calling it always on", () => {
    // The most dangerous state on the page and the easiest to render as
    // reassurance: "always on" beside "no email is sent" reads as a promise
    // where it is in fact a gap.
    const s = byKey(facts({ mailEnabled: false }), "critical_account");
    expect(s.canDisable).toBe(false);
    expect(s.reachesAccount).toBe(false);
    expect(s.deliveryGap).toBe(true);
  });

  it("does not flag a mandatory alert that is arriving", () => {
    expect(byKey(facts(), "critical_account").deliveryGap).toBe(false);
  });

  it("never calls an optional category a delivery gap", () => {
    // An optional alert nobody sends is a choice; a mandatory one is a fault.
    const all = categoryStatuses(facts({ mailEnabled: false }));
    expect(all.filter((s) => s.deliveryGap).map((s) => s.key)).toEqual([
      "critical_account",
      "automation_incidents",
    ]);
  });

  it("says assignment email is not sent, not that assignment does not exist", () => {
    const s = byKey(facts(), "assignments");
    expect(s.route).toBe("not_sent");
    expect(s.statement).toContain("Nobody is emailed");
    expect(s.statement).not.toContain("no way to assign work");
  });
});

describe("deliverySummary", () => {
  it("names the risk rather than describing the mechanism", () => {
    const s = deliverySummary(categoryStatuses(facts()));
    expect(s).toContain("Only critical account alerts are emailed");
    expect(s).toContain("unless they look");
  });

  it("says plainly when an account gets no email at all", () => {
    const s = deliverySummary(categoryStatuses(facts({ mailEnabled: false })));
    expect(s).toContain("no email from the platform at all");
  });
});
