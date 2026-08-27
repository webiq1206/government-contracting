import { describe, expect, it } from "vitest";
import {
  OWNER_FILTERS,
  describeOwner,
  matchesOwner,
  ownerName,
  parseOwnerFilter,
  type Owner,
} from "../lib/domain/ownership";
import { filterWorkItems, type WorkItem } from "../lib/domain/work-queue";

/**
 * Whose a piece of work is.
 *
 * The queue could already say when the next move belonged to somebody outside
 * the company. What it could not say is which of the three people in this
 * office is doing it, and the absence has a specific failure mode: everything
 * looks like it is on everybody, so the items that go overdue are the ones
 * each person assumed the other had picked up.
 */

const DANA: Owner = { id: "u1", name: "Dana" };
const SAM: Owner = { id: "u2", name: "Sam" };

function item(owner: Owner | null): WorkItem {
  return {
    key: `act:${owner?.id ?? "none"}`,
    kind: "review_bid",
    title: "Review the bid",
    context: "Fort Bliss",
    href: "/x",
    actionLabel: "Review",
    owner,
  };
}

describe("what the row says", () => {
  it("says Unassigned rather than leaving a blank", () => {
    // A blank in an owner column reads as a rendering fault and gets ignored.
    // The word is a state somebody can act on.
    expect(describeOwner(null)).toBe("Unassigned");
    expect(describeOwner(undefined)).toBe("Unassigned");
  });

  it("says You to the person it is on", () => {
    expect(describeOwner(DANA, "u1")).toBe("You");
    expect(describeOwner(DANA, "u2")).toBe("Dana");
  });
});

describe("the name a person is shown by", () => {
  it("prefers the name they gave", () => {
    expect(ownerName({ name: "Dana Reyes", email: "d@x.com" })).toBe("Dana Reyes");
  });

  it("never puts a whole email address on the screen", () => {
    /*
     * A queue row reading "someone@contractorco.com" is an address where a
     * name should be, and on a shared screen it is an address being shown to
     * whoever walks past.
     */
    expect(ownerName({ name: null, email: "someone@contractorco.com" })).toBe("someone");
    expect(ownerName({ name: "   ", email: "someone@contractorco.com" })).toBe("someone");
  });

  it("never renders empty, whatever it is given", () => {
    expect(ownerName({})).toBe("A teammate");
    expect(ownerName({ name: "", email: "" })).toBe("A teammate");
  });
});

describe("the filter", () => {
  it("fails wide on a value nobody recognises", () => {
    /*
     * Hidden work on Today is a missed deadline. A filter that fails closed on
     * a typo hides work; one that fails wide shows too much, which a person
     * can see and correct.
     */
    expect(parseOwnerFilter("nonsense")).toBe("anyone");
    expect(parseOwnerFilter(undefined)).toBe("anyone");
    for (const f of OWNER_FILTERS) expect(parseOwnerFilter(f)).toBe(f);
  });

  it("cuts the queue by whose it is", () => {
    const items = [item(DANA), item(SAM), item(null)];
    expect(filterWorkItems(items, { owner: "mine", viewerId: "u1" })).toHaveLength(1);
    expect(filterWorkItems(items, { owner: "unassigned", viewerId: "u1" })).toHaveLength(1);
    expect(filterWorkItems(items, { owner: "anyone", viewerId: "u1" })).toHaveLength(3);
  });

  it("shows everything rather than nothing when it does not know who is looking", () => {
    // A page that silently shows an empty list because it forgot to say who is
    // reading is worse than one that shows too much.
    const items = [item(DANA), item(SAM), item(null)];
    expect(filterWorkItems(items, { owner: "mine" })).toHaveLength(3);
  });

  it("treats unassigned as a real answer, not a missing one", () => {
    expect(matchesOwner(null, "unassigned", "u1")).toBe(true);
    expect(matchesOwner(DANA, "unassigned", "u1")).toBe(false);
  });
});
