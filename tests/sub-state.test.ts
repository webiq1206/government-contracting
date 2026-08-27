import { describe, expect, it } from "vitest";
import { subState, SUB_STATES, SUB_STATE_TONE, type SubStateFacts } from "@/lib/domain/sub-state";

function facts(over: Partial<SubStateFacts> = {}): SubStateFacts {
  return {
    blacklisted: false,
    email: "estimating@ridgeline.example",
    emailVerified: true,
    phone: "5125550143",
    missingDocuments: [],
    preferred: false,
    ...over,
  };
}

describe("subState ranking", () => {
  it("puts a block above everything else, paperwork included", () => {
    const v = subState(
      facts({ blacklisted: true, blacklistReason: "Walked off the Kelly Field job", preferred: true })
    );
    expect(v.state).toBe("do_not_use");
    expect(v.detail).toContain("Walked off the Kelly Field job");
    expect(v.canContact).toBe(false);
    expect(v.canAward).toBe(false);
  });

  it("says so when a block has no reason behind it, rather than hiding the gap", () => {
    const v = subState(facts({ blacklisted: true, blacklistReason: "   " }));
    expect(v.detail).toContain("No reason was recorded");
    expect(v.fix).toContain("Add the reason");
  });

  it("has nothing to fix when the block is already explained", () => {
    const v = subState(facts({ blacklisted: true, blacklistReason: "Priced two jobs and did neither" }));
    expect(v.fix).toBeNull();
  });

  it("reads a tombstone as a pointer, not as a firm", () => {
    const v = subState(facts({ mergedInto: "11111111-1111-1111-1111-111111111111" }));
    expect(v.state).toBe("put_aside");
    expect(v.label).toBe("Folded into another record");
    expect(v.canContact).toBe(false);
  });

  it("ranks the tombstone above the archive flag a merge also sets", () => {
    const v = subState(
      facts({ mergedInto: "11111111-1111-1111-1111-111111111111", archivedAt: "2026-08-01T00:00:00Z" })
    );
    expect(v.label).toBe("Folded into another record");
  });

  it("keeps put aside distinct from do not use, in the wording", () => {
    const v = subState(facts({ archivedAt: "2026-08-01T00:00:00Z", archivedReason: "Retired, no crew" }));
    expect(v.state).toBe("put_aside");
    expect(v.detail).toBe("Off the roster: Retired, no crew");
    expect(v.detail).not.toContain("blocked");
  });

  it("puts bad contact above missing paperwork: a firm nobody can reach is not a paperwork problem", () => {
    const v = subState(facts({ email: null, phone: null, missingDocuments: ["W-9"] }));
    expect(v.state).toBe("bad_contact");
  });

  it("distinguishes an unverified address from no address at all", () => {
    const unverified = subState(facts({ emailVerified: false, phone: null }));
    expect(unverified.state).toBe("bad_contact");
    expect(unverified.detail).toContain("has not passed verification");

    const nothing = subState(facts({ email: "  ", phone: "" }));
    expect(nothing.detail).toBe("No usable email and no phone number.");
  });

  it("counts a phone number on its own as reachable", () => {
    const v = subState(facts({ email: null, emailVerified: false, phone: "5125550143" }));
    expect(v.state).toBe("ready");
    expect(v.canContact).toBe(true);
  });
});

describe("missing documents", () => {
  /*
   * The judgement this whole module exists to hold. Paperwork blocks an award,
   * not a conversation, and treating a missing certificate as a reason not to
   * ask for a price is how a bid ends up with one quote.
   */
  it("blocks the award and leaves the conversation open", () => {
    const v = subState(facts({ missingDocuments: ["W-9", "Workers compensation insurance"] }));
    expect(v.state).toBe("missing_documents");
    expect(v.canContact).toBe(true);
    expect(v.canAward).toBe(false);
    expect(v.fix).toContain("does not stop you asking for a price");
  });

  it("names the documents and agrees with itself on the count", () => {
    const one = subState(facts({ missingDocuments: ["W-9"] }));
    expect(one.detail).toBe("1 document is missing or lapsed: W-9.");
    const two = subState(facts({ missingDocuments: ["W-9", "General liability insurance"] }));
    expect(two.detail).toBe(
      "2 documents are missing or lapsed: W-9, General liability insurance."
    );
  });

  it("outranks preferred, so a preferred firm with a lapsed policy still shows the lapse", () => {
    const v = subState(facts({ preferred: true, missingDocuments: ["General liability insurance"] }));
    expect(v.state).toBe("missing_documents");
  });
});

describe("clear states", () => {
  it("only says preferred about a firm that is otherwise ready", () => {
    const v = subState(facts({ preferred: true }));
    expect(v.state).toBe("preferred");
    expect(v.canAward).toBe(true);
    expect(v.fix).toBeNull();
  });

  it("falls through to ready", () => {
    const v = subState(facts());
    expect(v.state).toBe("ready");
    expect(v.canAward).toBe(true);
  });
});

describe("the verdict is always sayable", () => {
  it("never returns a bare badge: every state has a sentence behind it", () => {
    const cases: SubStateFacts[] = [
      facts({ blacklisted: true }),
      facts({ mergedInto: "x" }),
      facts({ archivedAt: "2026-08-01T00:00:00Z" }),
      facts({ email: null, phone: null }),
      facts({ missingDocuments: ["W-9"] }),
      facts({ preferred: true }),
      facts(),
    ];
    for (const c of cases) {
      const v = subState(c);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.detail.trim().length).toBeGreaterThan(0);
      expect(v.detail.trim().endsWith(".")).toBe(true);
      expect(SUB_STATES).toContain(v.state);
    }
  });

  it("has a tone for every state, so no screen has to invent one", () => {
    for (const s of SUB_STATES) {
      expect(SUB_STATE_TONE[s]).toBeTruthy();
    }
  });

  it("never offers an award to a firm nobody can contact", () => {
    const cases: SubStateFacts[] = [
      facts({ blacklisted: true }),
      facts({ mergedInto: "x" }),
      facts({ archivedAt: "2026-08-01T00:00:00Z" }),
      facts({ email: null, phone: null }),
    ];
    for (const c of cases) {
      const v = subState(c);
      expect(v.canContact).toBe(false);
      expect(v.canAward).toBe(false);
    }
  });
});

describe("federal exclusion", () => {
  it("outranks a local block, because the two have different fixes", () => {
    const v = subState(
      facts({ samExcluded: true, blacklisted: true, blacklistReason: "Slow to quote" })
    );
    expect(v.state).toBe("do_not_use");
    expect(v.label).toBe("Federally excluded");
    expect(v.canContact).toBe(false);
    expect(v.canAward).toBe(false);
  });

  it("offers no fix, because lifting it is not this roster's to do", () => {
    expect(subState(facts({ samExcluded: true })).fix).toBeNull();
  });

  it("outranks preferred and a clean paperwork record", () => {
    expect(subState(facts({ samExcluded: true, preferred: true })).label).toBe(
      "Federally excluded"
    );
  });
});
