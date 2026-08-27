import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_STATES,
  COMPLIANCE_STATE_LABEL,
  COMPLIANCE_STATE_TONE,
  complianceState,
  fromLegacyStatus,
  needsAttention,
  type ComplianceFacts,
} from "@/lib/domain/compliance-state";

const NOW = new Date("2026-08-27T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function facts(over: Partial<ComplianceFacts> = {}): ComplianceFacts {
  return { required: true, monitorable: true, ...over };
}

describe("the claim that used to be made from no evidence", () => {
  /*
   * "On track" was shown for any item the monitor had not flagged, including
   * items with no expiry date at all. A registration nobody had checked in a
   * year and one renewed last week read identically.
   */
  it("never says an item is fine when nothing is on file", () => {
    const v = complianceState(facts(), NOW);
    expect(v.state).toBe("incomplete");
    expect(v.detail).toBe("Required, and nothing on file.");
    expect(v.label).not.toMatch(/on track/i);
  });

  it("says complete only for something actually recorded", () => {
    const v = complianceState(facts({ satisfiedAt: inDays(-40) }), NOW);
    expect(v.state).toBe("complete");
  });

  it("never invents a countdown from a date nobody supplied", () => {
    const v = complianceState(facts({ satisfiedAt: inDays(-40) }), NOW);
    // Null, not zero. Zero would read as "lapses today".
    expect(v.daysLeft).toBeNull();
    expect(v.detail).toContain("No expiry date");
  });
});

describe("ranking", () => {
  it("puts a disagreement above an expiry, because you cannot act on either side of it", () => {
    const v = complianceState(
      facts({ conflict: "SAM says active, the certificate says lapsed in June", expiresAt: inDays(-10) }),
      NOW
    );
    expect(v.state).toBe("conflicting");
    expect(v.fix).toMatch(/Settle which is right/);
  });

  it("puts a lapse above everything else that is merely waiting", () => {
    const v = complianceState(
      facts({ expiresAt: inDays(-3), blockedBy: "the renewal invoice", needsReview: "check it" }),
      NOW
    );
    expect(v.state).toBe("expired");
    expect(v.detail).toBe("It lapsed 3 days ago.");
  });

  it("counts the day it lapses as expired rather than as one day left", () => {
    const v = complianceState(facts({ expiresAt: NOW.toISOString() }), NOW);
    expect(v.state).toBe("expired");
    expect(v.detail).toBe("It lapses today.");
  });

  it("names what a blocked item is waiting on", () => {
    const v = complianceState(facts({ blockedBy: "the state filing fee clearing" }), NOW);
    expect(v.state).toBe("blocked");
    expect(v.detail).toContain("state filing fee clearing");
  });

  it("makes a review somebody's job rather than a status nobody owns", () => {
    const v = complianceState(
      facts({ needsReview: "The certificate scan gave two different policy numbers." }),
      NOW
    );
    expect(v.state).toBe("needs_review");
    expect(v.fix).toMatch(/Somebody here has to confirm/);
  });

  it("counts down inside the window and says how long", () => {
    const v = complianceState(facts({ satisfiedAt: inDays(-100), expiresAt: inDays(9) }), NOW);
    expect(v.state).toBe("expiring_soon");
    expect(v.detail).toBe("9 days left.");
    expect(v.daysLeft).toBe(9);
  });

  it("takes a per-item window, because a bond is not a W-9", () => {
    const near = facts({ satisfiedAt: inDays(-100), expiresAt: inDays(60), windowDays: 90 });
    expect(complianceState(near, NOW).state).toBe("expiring_soon");
    expect(complianceState({ ...near, windowDays: 30 }, NOW).state).toBe("complete");
  });

  it("is complete, not expiring, outside the window", () => {
    const v = complianceState(facts({ satisfiedAt: inDays(-100), expiresAt: inDays(200) }), NOW);
    expect(v.state).toBe("complete");
    expect(v.detail).toContain("200 days left");
  });
});

describe("what the platform cannot check", () => {
  it("says so rather than showing a badge it has not earned", () => {
    const v = complianceState(facts({ monitorable: false }), NOW);
    expect(v.state).toBe("cannot_monitor");
    expect(v.fix).toMatch(/Check it yourself/);
  });

  it("still says so when somebody recorded it, because we cannot confirm it is current", () => {
    const v = complianceState(facts({ monitorable: false, satisfiedAt: inDays(-200) }), NOW);
    expect(v.state).toBe("cannot_monitor");
    expect(v.detail).toContain("nothing we can check confirms");
  });

  it("does not hide a real lapse behind it", () => {
    // A date we do have beats an inability to check for one we do not.
    const v = complianceState(facts({ monitorable: false, expiresAt: inDays(-1) }), NOW);
    expect(v.state).toBe("expired");
  });
});

describe("an operator's own word", () => {
  it("beats everything the platform worked out, and says that it did", () => {
    const v = complianceState(
      facts({ override: "complete", expiresAt: inDays(-30) }),
      NOW
    );
    expect(v.state).toBe("complete");
    expect(v.fromOperator).toBe(true);
    expect(v.detail).toMatch(/Set by somebody here/);
  });

  it("still reports the real countdown alongside the override", () => {
    // The override changes the verdict, not the arithmetic.
    const v = complianceState(facts({ override: "complete", expiresAt: inDays(-30) }), NOW);
    expect(v.daysLeft).toBe(-30);
  });
});

describe("the vocabulary itself", () => {
  it("has exactly the eight states, and a label and tone for each", () => {
    expect(COMPLIANCE_STATES).toHaveLength(8);
    for (const s of COMPLIANCE_STATES) {
      expect(COMPLIANCE_STATE_LABEL[s]).toBeTruthy();
      expect(COMPLIANCE_STATE_TONE[s]).toBeTruthy();
    }
  });

  it("contains none of the banned vague words", () => {
    const words = Object.values(COMPLIANCE_STATE_LABEL).join(" ").toLowerCase();
    for (const banned of ["on track", "pending", "processing", "connected", "open"]) {
      expect(words).not.toContain(banned);
    }
  });

  it("puts exactly the five that need somebody today in front of them", () => {
    const attention = COMPLIANCE_STATES.filter(needsAttention);
    expect(attention).toEqual([
      "conflicting", "expired", "blocked", "needs_review", "expiring_soon",
    ]);
  });
});

describe("rows written before this vocabulary existed", () => {
  it("carries the old severities across where they meant something", () => {
    expect(fromLegacyStatus("warning")).toBe("expiring_soon");
    expect(fromLegacyStatus("critical")).toBe("expired");
    expect(fromLegacyStatus("blocked")).toBe("blocked");
    expect(fromLegacyStatus("resolved")).toBe("complete");
  });

  it("refuses to turn ok into complete, because that is the claim being removed", () => {
    /*
     * `ok` meant "the monitor did not flag this", which on an item with no
     * date on file is exactly the unearned green badge this vocabulary
     * exists to stop. Null sends it back through the facts.
     */
    expect(fromLegacyStatus("ok")).toBeNull();
  });

  it("passes a new value through untouched, and refuses an unknown one", () => {
    expect(fromLegacyStatus("needs_review")).toBe("needs_review");
    expect(fromLegacyStatus("nonsense")).toBeNull();
    expect(fromLegacyStatus(null)).toBeNull();
  });
});
