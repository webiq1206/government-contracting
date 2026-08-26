import { describe, expect, it } from "vitest";
import {
  blockingSuppression,
  countsAsAttempt,
  describeStopImpact,
  parseChannel,
  parseScope,
  parseSkipReason,
  skipMayNotSet,
  suppressionForSkip,
  type Suppression,
} from "../lib/domain/suppression";

/**
 * Telling the platform to stop contacting somebody, and having it stay told.
 *
 * The skip already worked. What it could not do is last: the next Call Prep
 * run rebuilt the card, the next sweep sent the next email, and the decision
 * survived exactly as long as the row that was clicked. The narrow version of
 * that bug is a re-appearing task. The real one reaches a subcontractor who
 * asked not to be rung and keeps getting rung, over the operator's name.
 *
 * Most of what is asserted here is the scoping, because the scoping is where
 * this goes wrong in the direction that matters: too narrow and the stop does
 * nothing, too wide and a firm is cut off from a channel nobody closed.
 */

function s(patch: Partial<Suppression> = {}): Suppression {
  return {
    subcontractorId: "sub-1",
    opportunityId: "opp-1",
    trade: "Electrical",
    channel: "call",
    reason: "prefer_email",
    ...patch,
  };
}

describe("how far a stop reaches", () => {
  it("stops the trade it names and no other", () => {
    const live = [s()];
    expect(
      blockingSuppression(live, {
        subcontractorId: "sub-1",
        opportunityId: "opp-1",
        trade: "Electrical",
        channel: "call",
      })
    ).toBeTruthy();
    expect(
      blockingSuppression(live, {
        subcontractorId: "sub-1",
        opportunityId: "opp-1",
        trade: "Plumbing",
        channel: "call",
      })
    ).toBeNull();
  });

  it("stops every trade when it names none", () => {
    const live = [s({ trade: null })];
    for (const trade of ["Electrical", "Plumbing", null]) {
      expect(
        blockingSuppression(live, {
          subcontractorId: "sub-1",
          opportunityId: "opp-1",
          trade,
          channel: "call",
        })
      ).toBeTruthy();
    }
  });

  it("does not let a trade-scoped stop catch an attempt with no trade", () => {
    // "Stop calling them about Electrical" cannot decide a call that is not
    // about a trade. Treating it as covered would silence approaches nobody
    // ruled on.
    const live = [s()];
    expect(
      blockingSuppression(live, {
        subcontractorId: "sub-1",
        opportunityId: "opp-1",
        trade: null,
        channel: "call",
      })
    ).toBeNull();
  });

  it("stops every bid when it names no opportunity", () => {
    const live = [s({ opportunityId: null, trade: null })];
    expect(
      blockingSuppression(live, {
        subcontractorId: "sub-1",
        opportunityId: "a-different-bid",
        trade: "Roofing",
        channel: "call",
      })
    ).toBeTruthy();
  });

  it("never reaches a different subcontractor", () => {
    expect(
      blockingSuppression([s({ opportunityId: null, trade: null })], {
        subcontractorId: "sub-2",
        opportunityId: "opp-1",
        trade: "Electrical",
        channel: "call",
      })
    ).toBeNull();
  });
});

describe("which channel a stop closes", () => {
  it("leaves email alone when only calls were stopped", () => {
    const live = [s({ trade: null })];
    // A firm that will not take phone calls will often still answer email.
    expect(
      blockingSuppression(live, {
        subcontractorId: "sub-1",
        opportunityId: "opp-1",
        trade: "Electrical",
        channel: "email",
      })
    ).toBeNull();
  });

  it("closes both when the stop is everything", () => {
    const live = [s({ trade: null, channel: "all" })];
    for (const channel of ["call", "email"] as const) {
      expect(
        blockingSuppression(live, {
          subcontractorId: "sub-1",
          opportunityId: "opp-1",
          trade: "Electrical",
          channel,
        })
      ).toBeTruthy();
    }
  });

  it("reads an unrecognised channel as the widest stop", () => {
    // The failure that reaches somebody's inbox is the one where an
    // unreadable suppression lets a message out, so this fails wide.
    expect(parseChannel("smoke signals")).toBe("all");
    expect(parseChannel(undefined)).toBe("all");
    expect(parseChannel("call")).toBe("call");
  });
});

describe("a lifted stop", () => {
  it("stops nothing", () => {
    const live = [s({ trade: null, liftedAt: new Date("2026-03-01T00:00:00Z") })];
    expect(
      blockingSuppression(live, {
        subcontractorId: "sub-1",
        opportunityId: "opp-1",
        trade: "Electrical",
        channel: "call",
      })
    ).toBeNull();
  });
});

describe("what a skip writes", () => {
  it("writes nothing at all for a one-time skip", () => {
    // The important default. A one-time skip that quietly created a standing
    // rule is how an operator stops speaking to a firm because they were busy
    // on a Tuesday.
    expect(
      suppressionForSkip({
        scope: "once",
        subcontractorId: "sub-1",
        opportunityId: "opp-1",
        trade: "Electrical",
        reason: "wrong_time",
      })
    ).toBeNull();
  });

  it("scopes a trade skip to that trade on that bid", () => {
    const w = suppressionForSkip({
      scope: "opportunity_trade",
      subcontractorId: "sub-1",
      opportunityId: "opp-1",
      trade: "Electrical",
      reason: "prefer_email",
    });
    expect(w?.opportunityId).toBe("opp-1");
    expect(w?.trade).toBe("Electrical");
    // A call skip never closes email.
    expect(w?.channel).toBe("call");
  });

  it("scopes a firm-wide skip to every bid and every trade", () => {
    const w = suppressionForSkip({
      scope: "subcontractor",
      subcontractorId: "sub-1",
      opportunityId: "opp-1",
      trade: "Electrical",
      reason: "prefer_email",
    });
    expect(w?.opportunityId).toBeNull();
    expect(w?.trade).toBeNull();
  });

  it("falls back to the narrowest scope on anything unreadable", () => {
    expect(parseScope("everything forever")).toBe("once");
    expect(parseScope(undefined)).toBe("once");
    expect(parseScope("subcontractor")).toBe("subcontractor");
  });

  it("keeps the reason inside the named list", () => {
    expect(parseSkipReason("email_response_received")).toBe("email_response_received");
    expect(parseSkipReason("because I felt like it")).toBeNull();
  });
});

describe("what a skip is not", () => {
  it("is not a decline, an unresponsive firm, or a lost lead", () => {
    // Each of these was a plausible thing for a caller to write, and each is
    // a lie about a subcontractor who has done nothing.
    for (const state of ["declined", "unresponsive", "no_response", "not_interested"]) {
      expect(skipMayNotSet(state)).toBe(true);
    }
    expect(skipMayNotSet("responsive")).toBe(false);
    expect(skipMayNotSet("sent")).toBe(false);
  });

  it("is not an attempt unless somebody dialled", () => {
    expect(countsAsAttempt(false)).toBe(false);
    expect(countsAsAttempt(true)).toBe(true);
  });
});

describe("what the confirmation screen says before anything stops", () => {
  const scope = {
    subcontractorId: "sub-1",
    opportunityId: "opp-1",
    trade: null,
    channel: "all" as const,
  };

  it("counts what is actually cancelled", () => {
    const lines = describeStopImpact(
      {
        queuedEmails: 2,
        scheduledFollowUps: 1,
        pendingCalls: 3,
        openTasks: 0,
        clarificationRequests: 0,
        uncoveredTrades: [],
      },
      scope
    ).join(" ");
    expect(lines).toContain("2 queued emails");
    expect(lines).toContain("1 scheduled follow-up");
    expect(lines).toContain("3 queued calls");
  });

  it("says plainly when nothing is queued today", () => {
    const lines = describeStopImpact(
      {
        queuedEmails: 0,
        scheduledFollowUps: 0,
        pendingCalls: 0,
        openTasks: 0,
        clarificationRequests: 0,
        uncoveredTrades: [],
      },
      scope
    ).join(" ");
    // Not silence, which would read as "this button does nothing".
    expect(lines).toContain("Nothing is currently queued");
    expect(lines).toContain("Future automation will not approach them");
  });

  it("promises to keep what it keeps", () => {
    const lines = describeStopImpact(
      {
        queuedEmails: 1,
        scheduledFollowUps: 0,
        pendingCalls: 0,
        openTasks: 0,
        clarificationRequests: 0,
        uncoveredTrades: [],
      },
      scope
    ).join(" ");
    expect(lines).toContain("Messages already sent");
    expect(lines).toContain("history are all kept");
  });

  it("names a trade this would leave with nobody", () => {
    // The number that changes an operator's mind, and the one nothing else on
    // the screen would tell them.
    const lines = describeStopImpact(
      {
        queuedEmails: 0,
        scheduledFollowUps: 1,
        pendingCalls: 0,
        openTasks: 0,
        clarificationRequests: 0,
        uncoveredTrades: ["Electrical", "Roofing"],
      },
      scope
    ).join(" ");
    expect(lines).toContain("Electrical and Roofing");
    expect(lines).toContain("nobody responding");
  });
});
