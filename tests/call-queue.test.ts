/**
 * Working a call queue.
 *
 * The rule that matters most here is the one about not guessing: a state that
 * spans two time zones gets no local time at all, because a confident wrong
 * hour is the difference between an operator checking and an operator
 * dialling somebody at six in the morning.
 */
import { describe, it, expect } from "vitest";
import {
  localTimeFor,
  contactQuality,
  callReason,
  callQueueCounts,
  groupCalls,
  filterCalls,
  parseCallGrouping,
  CONTACT_QUALITY_LABEL,
  CALL_GROUPINGS,
  CALL_GROUPING_LABEL,
  type CallCardFacts,
} from "@/lib/domain/call-queue";

/*
 * 15:00 UTC in August, which is daylight saving time across the mainland:
 * 11am in New York, 10am in Chicago, 9am in Denver, 8am in Los Angeles, 7am
 * in Anchorage, and 5am in Honolulu, which does not observe it. Intl handles
 * the offset, so these are the real hours rather than standard-time ones.
 */
const NOW = new Date("2026-08-26T15:00:00Z");

function card(over: Partial<CallCardFacts> & { id: string }): CallCardFacts {
  return {
    companyName: "Acme Electric",
    trade: "electrical",
    opportunityId: "o1",
    opportunityTitle: "Base electrical upgrade",
    deadline: "2026-09-30T00:00:00Z",
    source: null,
    phone: "555-0100",
    email: "sub@example.test",
    emailVerified: true,
    state: "NY",
    lastContacted: null,
    attempts: 0,
    ...over,
  };
}

describe("localTimeFor", () => {
  it("refuses to guess for a state that spans two zones", () => {
    for (const s of ["FL", "TX", "ND", "SD", "KS", "NE", "IN", "KY", "TN", "MI", "OR", "ID"]) {
      const t = localTimeFor(s, NOW);
      expect(t.label).toBeNull();
      expect(t.reasonableHour).toBeNull();
      expect(t.note).toContain("more than one time zone");
    }
  });

  it("says nothing rather than assuming when there is no state", () => {
    const t = localTimeFor(null, NOW);
    expect(t.label).toBeNull();
    expect(t.note).toContain("No location on file");
  });

  it("reads the hour where they are, not where we are", () => {
    expect(localTimeFor("NY", NOW).label).toBe("11:00 AM");
    expect(localTimeFor("CA", NOW).label).toBe("8:00 AM");
    expect(localTimeFor("CO", NOW).label).toBe("9:00 AM");
    // Arizona does not observe daylight saving, so it is an hour behind
    // Denver in August despite sharing a standard offset.
    expect(localTimeFor("AZ", NOW).label).toBe("8:00 AM");
    expect(localTimeFor("HI", NOW).label).toBe("5:00 AM");
  });

  it("calls five in the morning an unreasonable hour and eight a reasonable one", () => {
    expect(localTimeFor("HI", NOW).reasonableHour).toBe(false);
    expect(localTimeFor("AK", NOW).reasonableHour).toBe(false);
    expect(localTimeFor("CA", NOW).reasonableHour).toBe(true);
    expect(localTimeFor("NY", NOW).reasonableHour).toBe(true);
  });

  it("is case and whitespace tolerant", () => {
    expect(localTimeFor(" ny ", NOW).label).toBe("11:00 AM");
  });
});

describe("contactQuality", () => {
  it("separates a confirmed email from an unconfirmed one", () => {
    expect(contactQuality(card({ id: "a" }))).toBe("phone_verified_email");
    expect(contactQuality(card({ id: "b", emailVerified: false }))).toBe("phone_only");
    expect(contactQuality(card({ id: "c", email: null }))).toBe("phone_only");
  });

  it("names a card that cannot be called at all", () => {
    expect(contactQuality(card({ id: "d", phone: null }))).toBe("no_phone");
    expect(CONTACT_QUALITY_LABEL.no_phone).toBe("No phone number");
  });
});

describe("callReason", () => {
  it("leads with the reply when there is one", () => {
    expect(callReason(card({ id: "a", source: "reply" }), NOW)).toContain("They wrote back");
  });

  it("says how many times it has been tried", () => {
    const r = callReason(card({ id: "b", attempts: 2 }), NOW);
    expect(r).toContain("Called 2 times already");
    expect(r).toContain("different hour");
  });

  it("counts the days since the email rather than printing a date", () => {
    const r = callReason(
      card({ id: "c", lastContacted: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }),
      NOW
    );
    expect(r).toContain("3 days ago");
  });

  it("says today rather than 0 days ago", () => {
    const r = callReason(card({ id: "d", lastContacted: NOW.toISOString() }), NOW);
    expect(r).toContain("today");
    expect(r).not.toContain("0 day");
  });

  it("does not invent a history for a card with none", () => {
    expect(callReason(card({ id: "e" }), NOW)).toContain("no call has been made yet");
  });

  it("survives an unparseable last-contact date", () => {
    const r = callReason(card({ id: "f", lastContacted: "whenever" }), NOW);
    expect(r).toContain("A call is the next step");
    expect(r).not.toContain("NaN");
  });
});

describe("callQueueCounts", () => {
  it("counts what stops a call happening, not just how many there are", () => {
    const c = callQueueCounts(
      [
        card({ id: "1", deadline: "2026-08-27T00:00:00Z" }),
        card({ id: "2", state: "HI" }),
        card({ id: "3", phone: null }),
        card({ id: "4" }),
      ],
      NOW
    );
    expect(c.remaining).toBe(4);
    expect(c.urgent).toBe(1);
    expect(c.badHour).toBe(1);
    expect(c.unreachable).toBe(1);
  });

  it("does not count a card with no deadline as urgent", () => {
    expect(callQueueCounts([card({ id: "1", deadline: null })], NOW).urgent).toBe(0);
  });

  it("does not count a card with an unknown hour as a bad hour", () => {
    /*
     * Unknown is not bad. Counting it would put every Texan subcontractor in
     * the "do not call yet" number.
     */
    expect(callQueueCounts([card({ id: "1", state: "TX" })], NOW).badHour).toBe(0);
  });
});

describe("groupCalls", () => {
  const cards = [
    card({ id: "1", opportunityId: "a", opportunityTitle: "Job A", trade: "electrical" }),
    card({ id: "2", opportunityId: "b", opportunityTitle: "Job B", trade: "electrical" }),
    card({ id: "3", opportunityId: "a", opportunityTitle: "Job A", trade: "paving" }),
  ];

  it("keeps the incoming order inside each group", () => {
    /*
     * The queue arrives soonest-deadline first with replies on top. Regrouping
     * must not quietly resort it, or the first card in a group stops being the
     * one to call first.
     */
    const byOpp = groupCalls(cards, "opportunity");
    expect(byOpp.map((g) => g.label)).toEqual(["Job A", "Job B"]);
    expect(byOpp[0].cards.map((c) => c.id)).toEqual(["1", "3"]);
  });

  it("groups by trade", () => {
    const byTrade = groupCalls(cards, "trade");
    expect(byTrade.map((g) => g.label)).toEqual(["electrical", "paving"]);
  });

  it("returns one unlabelled group when not grouping", () => {
    const flat = groupCalls(cards, "none");
    expect(flat).toHaveLength(1);
    expect(flat[0].cards).toHaveLength(3);
  });

  it("names the group for a card with nothing to group by", () => {
    const g = groupCalls([card({ id: "x", trade: null })], "trade");
    expect(g[0].label).toBe("No trade recorded");
  });

  it("falls open to no grouping on a bad parameter", () => {
    expect(parseCallGrouping("nonsense")).toBe("none");
    expect(parseCallGrouping(undefined)).toBe("none");
    expect(parseCallGrouping("trade")).toBe("trade");
    for (const g of CALL_GROUPINGS) expect(CALL_GROUPING_LABEL[g]).toBeTruthy();
  });
});

describe("filterCalls", () => {
  const cards = [
    card({ id: "1", companyName: "Rivera Mechanical", trade: "hvac" }),
    card({ id: "2", companyName: "Acme Electric", opportunityTitle: "Base paving" }),
  ];

  it("matches company, trade or solicitation", () => {
    expect(filterCalls(cards, "rivera").map((c) => c.id)).toEqual(["1"]);
    expect(filterCalls(cards, "hvac").map((c) => c.id)).toEqual(["1"]);
    expect(filterCalls(cards, "paving").map((c) => c.id)).toEqual(["2"]);
  });

  it("returns everything for an empty search", () => {
    expect(filterCalls(cards, "   ")).toHaveLength(2);
  });
});
