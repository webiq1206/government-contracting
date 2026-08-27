import { describe, expect, it } from "vitest";
import {
  compareDeadline,
  compareDocuments,
  compareMetadata,
  compareRequirements,
  compareTrades,
  conflictsBetween,
  normalizeText,
  type DocumentFacts,
  type RequirementFacts,
} from "../lib/domain/reverification-compare";

/**
 * What counts as a difference.
 *
 * The two ways to get this wrong are opposite and both bad. Too sensitive and
 * every run reports thirty changes, mostly whitespace, and people stop reading
 * the report. Too forgiving and a requirement that gained the word "not" reads
 * as unchanged.
 */

describe("what is loosened before matching", () => {
  it("ignores case, spacing and the punctuation that differs between renderings", () => {
    expect(normalizeText("  Offers   are DUE  by 3 p.m. ")).toBe(
      normalizeText("offers are due by 3 p.m.")
    );
    expect(normalizeText("don’t")).toBe(normalizeText("don't"));
  });

  it("never loosens a negation or a number", () => {
    // The whole point. These are the two differences that cost money and the
    // two that a sloppy normaliser eats.
    expect(normalizeText("shall be bonded")).not.toBe(normalizeText("shall not be bonded"));
    expect(normalizeText("$20,000")).not.toBe(normalizeText("$2,000"));
    expect(normalizeText("20 pages")).not.toBe(normalizeText("30 pages"));
  });
});

describe("metadata", () => {
  it("says nothing changed when nothing did", () => {
    const f = compareMetadata([
      { label: "Agency", before: "Dept of the Navy", after: "dept of the navy ", cosmetic: true },
    ]);
    expect(f[0]?.kind).toBe("unchanged");
  });

  it("treats a field that gained a value as an addition, not a change", () => {
    // "We did not know and now we do" is not "the source moved".
    const f = compareMetadata([{ label: "Place of performance", before: null, after: "Norfolk, VA" }]);
    expect(f[0]?.kind).toBe("added");
  });

  it("keeps a value the source stopped publishing, and says it is unconfirmed", () => {
    const f = compareMetadata([{ label: "Set aside", before: "SDVOSB", after: null }]);
    expect(f[0]?.kind).toBe("removed");
    expect(f[0]?.before).toBe("SDVOSB");
    expect(f[0]?.note).toContain("no longer confirmed");
  });

  it("is material by default, and cosmetic only where it is said to be", () => {
    const [material] = compareMetadata([{ label: "NAICS", before: "238210", after: "238220" }]);
    const [cosmetic] = compareMetadata([
      { label: "Contact name", before: "A Smith", after: "Alice Smith", cosmetic: true },
    ]);
    expect(material?.impact).toBe("material");
    expect(cosmetic?.impact).toBe("safe_metadata");
  });
});

describe("the deadline", () => {
  const base = {
    label: "Offer deadline",
    beforeTimezone: "America/New_York",
    afterTimezone: "America/New_York",
  };

  it("blocks when the close moved earlier", () => {
    const [f] = compareDeadline({
      ...base,
      before: new Date("2026-04-01T17:00:00Z"),
      after: new Date("2026-03-20T17:00:00Z"),
    });
    // Every other change costs attention. This one costs the bid, because
    // everything scheduled against the old date is now late.
    expect(f?.impact).toBe("blocking");
    expect(f?.note).toContain("already late");
  });

  it("is material rather than blocking when the close moved later", () => {
    const [f] = compareDeadline({
      ...base,
      before: new Date("2026-04-01T17:00:00Z"),
      after: new Date("2026-04-15T17:00:00Z"),
    });
    expect(f?.impact).toBe("material");
  });

  it("blocks when the source stopped publishing a close date", () => {
    const [f] = compareDeadline({ ...base, before: new Date("2026-04-01T17:00:00Z"), after: null });
    expect(f?.impact).toBe("blocking");
    expect(f?.note).toContain("unconfirmed");
  });

  it("reports a timezone move at the same clock time as a real change", () => {
    const [f] = compareDeadline({
      label: "Offer deadline",
      before: new Date("2026-04-01T17:00:00Z"),
      after: new Date("2026-04-01T17:00:00Z"),
      beforeTimezone: "America/New_York",
      afterTimezone: "America/Chicago",
    });
    expect(f?.kind).toBe("changed");
    expect(f?.impact).toBe("material");
  });

  it("says nothing when the moment and the zone both held", () => {
    const [f] = compareDeadline({
      ...base,
      before: new Date("2026-04-01T17:00:00Z"),
      after: new Date("2026-04-01T17:00:00Z"),
    });
    expect(f?.kind).toBe("unchanged");
  });
});

describe("the attachment manifest", () => {
  const doc = (patch: Partial<DocumentFacts>): DocumentFacts => ({
    key: "att-1",
    name: "Attachment 1 - SOW.pdf",
    contentHash: "aaa",
    pageCount: 12,
    readable: true,
    ...patch,
  });

  it("catches a re-upload under the same filename", () => {
    // The case this exists for. Agencies re-upload attachments under the same
    // name constantly, and a manifest keyed on names reports nothing happened.
    const [f] = compareDocuments([doc({})], [doc({ contentHash: "bbb" })]);
    expect(f?.kind).toBe("changed");
    expect(f?.note).toContain("Same filename, different contents");
  });

  it("mentions a length change when it can", () => {
    const [f] = compareDocuments([doc({})], [doc({ contentHash: "bbb", pageCount: 40 })]);
    expect(f?.note).toContain("12 to 40 pages");
  });

  it("does not call two unknown hashes a match", () => {
    // Two nulls compare equal and mean "nobody hashed either one", which is
    // the absence of evidence rather than evidence of sameness.
    const [f] = compareDocuments(
      [doc({ contentHash: null })],
      [doc({ contentHash: null })]
    );
    expect(f?.kind).toBe("unreadable");
    expect(f?.note).toContain("not actually been compared");
  });

  it("reports a file that would not open as unconfirmed, not unchanged", () => {
    const [f] = compareDocuments([doc({})], [doc({ readable: false })]);
    expect(f?.kind).toBe("unreadable");
    expect(f?.note).toContain("unconfirmed rather than unchanged");
  });

  it("names a document the record has never seen", () => {
    const f = compareDocuments([doc({})], [doc({}), doc({ key: "att-2", name: "Amendment 0001.pdf", contentHash: "ccc" })]);
    const added = f.find((x) => x.kind === "added");
    expect(added?.subject).toBe("Amendment 0001.pdf");
    expect(added?.note).toContain("Nothing extracted so far includes it");
  });

  it("keeps a document the source dropped, labelled rather than deleted", () => {
    const f = compareDocuments([doc({}), doc({ key: "att-2", name: "Old spec.pdf" })], [doc({})]);
    const removed = f.find((x) => x.kind === "removed");
    expect(removed?.subject).toBe("Old spec.pdf");
    expect(removed?.note).toContain("superseded rather than deleted");
  });
});

describe("requirements", () => {
  const req = (patch: Partial<RequirementFacts>): RequirementFacts => ({
    id: "sf1449",
    title: "Signed SF-1449 (offer form)",
    mandatory: true,
    ...patch,
  });

  it("catches an item that became mandatory even with identical wording", () => {
    const [f] = compareRequirements(
      [req({ mandatory: false })],
      [req({ mandatory: true })]
    );
    // The change most likely to lose a bid: the package is assembled from what
    // is mandatory, so a silently promoted item was never being collected.
    expect(f?.kind).toBe("changed");
    expect(f?.impact).toBe("blocking");
    expect(f?.note).toContain("was not being collected");
  });

  it("blocks on a new mandatory item", () => {
    const f = compareRequirements([], [req({})]);
    expect(f[0]?.kind).toBe("added");
    expect(f[0]?.impact).toBe("blocking");
  });

  it("keeps an item the new read did not find rather than dropping it", () => {
    const f = compareRequirements([req({})], []);
    expect(f[0]?.kind).toBe("removed");
    expect(f[0]?.note).toContain("kept and flagged rather than dropped");
  });

  it("ignores a rewording that is only whitespace and case", () => {
    const f = compareRequirements(
      [req({ title: "Signed SF-1449 (offer form)" })],
      [req({ title: "  signed sf-1449 (offer form) " })]
    );
    expect(f[0]?.kind).toBe("unchanged");
  });

  it("does not ignore a rewording that changed the meaning", () => {
    const f = compareRequirements(
      [req({ title: "Bid bond is not required" })],
      [req({ title: "Bid bond is required" })]
    );
    expect(f[0]?.kind).toBe("changed");
  });
});

describe("trades", () => {
  it("blocks on a trade nobody has been asked to price", () => {
    const f = compareTrades(["Electrical"], ["Electrical", "Fire suppression"]);
    const added = f.find((x) => x.kind === "added");
    expect(added?.impact).toBe("blocking");
    expect(added?.note).toContain("no coverage and no quote");
  });

  it("says to stop chasing a trade that left the scope", () => {
    const f = compareTrades(["Electrical", "Plumbing"], ["Electrical"]);
    const removed = f.find((x) => x.kind === "removed");
    expect(removed?.note).toContain("Do not chase it further");
  });

  it("matches the same trade written differently", () => {
    const f = compareTrades(["HVAC"], ["  hvac "]);
    expect(f.every((x) => x.kind === "unchanged")).toBe(true);
  });
});

describe("when two readings disagree", () => {
  it("reports the disagreement with both sides intact", () => {
    const [f] = conflictsBetween(
      [{ id: "bond", title: "Bid bond", mandatory: false }],
      [{ id: "bond", title: "Bid bond", mandatory: true, citation: "Section L.3 [p.14]" }]
    );
    expect(f?.kind).toBe("conflict");
    expect(f?.before).toContain("Optional on file");
    expect(f?.after).toContain("Read as mandatory");
    expect(f?.citation).toBe("Section L.3 [p.14]");
    // The temptation is to prefer the newer reading because it is newer. Both
    // came from the same kind of process on the same document.
    expect(f?.note).toContain("more current, not more correct");
  });

  it("says nothing when the two readings agree", () => {
    expect(
      conflictsBetween(
        [{ id: "bond", title: "Bid bond", mandatory: true }],
        [{ id: "bond", title: "Bid bond", mandatory: true }]
      )
    ).toEqual([]);
  });
});
