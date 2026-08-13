import { describe, it, expect } from "vitest";
import {
  EMPTY_W9,
  W9_CERTIFICATION,
  W9_CERTIFICATION_VERSION,
  canonicalW9Text,
  classificationLabel,
  formatTin,
  maskedTin,
  normalizeTin,
  tinLast4,
  tinLooksValid,
  validateW9,
  type W9FormData,
} from "@/lib/domain/w9";
import { encryptTin, decryptTin, w9DocHash, w9HashMatches } from "@/lib/domain/w9-crypto";

const SIGNED_AT = new Date("2026-08-13T15:04:05.000Z");

const complete = (over: Partial<W9FormData> = {}): W9FormData => ({
  ...EMPTY_W9,
  legalName: "Dana Ruiz",
  businessName: "Ruiz Mechanical",
  taxClassification: "sole_proprietor",
  address: "412 Front Street",
  city: "Sacramento",
  state: "CA",
  zip: "95814",
  tinType: "ssn",
  tin: "412-55-8890",
  signedName: "Dana Ruiz",
  certified: true,
  ...over,
});

describe("taxpayer identification numbers", () => {
  it("strips whatever punctuation the number was typed with", () => {
    expect(normalizeTin("412-55-8890")).toBe("412558890");
    expect(normalizeTin(" 41 25 58 890 ")).toBe("412558890");
  });

  it("formats by type, because an SSN and an EIN are grouped differently", () => {
    expect(formatTin("412558890", "ssn")).toBe("412-55-8890");
    expect(formatTin("412558890", "ein")).toBe("41-2558890");
  });

  it("shows only the last four", () => {
    expect(tinLast4("412-55-8890")).toBe("8890");
    expect(maskedTin("8890", "ssn")).toBe("XXX-XX-8890");
    expect(maskedTin("8890", "ein")).toBe("XX-XXX8890");
  });

  it("rejects the numbers that are definitely not real", () => {
    expect(tinLooksValid("000000000", "ssn")).toBe(false);
    expect(tinLooksValid("123456789", "ssn")).toBe(false);
    expect(tinLooksValid("000-55-8890", "ssn")).toBe(false);
    expect(tinLooksValid("666-55-8890", "ssn")).toBe(false);
    expect(tinLooksValid("412-00-8890", "ssn")).toBe(false);
    expect(tinLooksValid("412-55-0000", "ssn")).toBe(false);
    expect(tinLooksValid("4125588", "ssn")).toBe(false);
  });

  it("accepts an ITIN, which is valid on a W-9 and begins with 9", () => {
    expect(tinLooksValid("912-70-8890", "ssn")).toBe(true);
  });

  it("does not apply SSN structure rules to an EIN", () => {
    // 00 in the middle is invalid for an SSN and unremarkable for an EIN.
    expect(tinLooksValid("41-0058890", "ein")).toBe(true);
  });
});

describe("what the form will not let through", () => {
  it("passes a complete form", () => {
    expect(validateW9(complete())).toEqual({});
  });

  it("will not sign without the certification ticked", () => {
    expect(validateW9(complete({ certified: false })).certified).toBeTruthy();
  });

  it("will not sign without a typed name", () => {
    expect(validateW9(complete({ signedName: " " })).signedName).toBeTruthy();
  });

  it("makes an LLC say how it is taxed", () => {
    expect(validateW9(complete({ taxClassification: "llc" })).llcTaxClass).toBeTruthy();
    expect(validateW9(complete({ taxClassification: "llc", llcTaxClass: "S" }))).toEqual({});
  });

  it("makes 'other' explain itself", () => {
    expect(validateW9(complete({ taxClassification: "other" })).otherDescription).toBeTruthy();
  });

  it("tells a short number and a wrong number apart", () => {
    expect(validateW9(complete({ tin: "4125" })).tin).toContain("all 9 digits");
    expect(validateW9(complete({ tin: "000000000" })).tin).toContain("does not look like");
  });

  it("holds the address to something mailable", () => {
    expect(validateW9(complete({ state: "California" })).state).toBeTruthy();
    expect(validateW9(complete({ zip: "958" })).zip).toBeTruthy();
    expect(validateW9(complete({ zip: "95814-2201" }))).toEqual({});
  });

  it("leaves the rare codes optional but checks them when filled in", () => {
    expect(validateW9(complete({ exemptPayeeCode: "" }))).toEqual({});
    expect(validateW9(complete({ exemptPayeeCode: "abc" })).exemptPayeeCode).toBeTruthy();
    expect(validateW9(complete({ fatcaCode: "12" })).fatcaCode).toBeTruthy();
  });
});

describe("the document that gets signed", () => {
  const meta = { signedName: "Dana Ruiz", signedAt: SIGNED_AT, companyName: "Ruiz Mechanical" };

  it("never puts the full number in the text", () => {
    const text = canonicalW9Text(complete(), meta);
    expect(text).not.toContain("412558890");
    expect(text).not.toContain("412-55-8890");
    expect(text).toContain("XXX-XX-8890");
  });

  it("carries the certification verbatim, all four clauses", () => {
    const text = canonicalW9Text(complete(), meta);
    for (const clause of W9_CERTIFICATION) expect(text).toContain(clause);
    expect(text).toContain(W9_CERTIFICATION_VERSION);
  });

  it("is identical for identical input, which is what makes the hash mean anything", () => {
    expect(canonicalW9Text(complete(), meta)).toBe(canonicalW9Text(complete(), meta));
  });

  it("changes when any answer changes", () => {
    const before = canonicalW9Text(complete(), meta);
    const after = canonicalW9Text(complete({ legalName: "Dana R Ruiz" }), meta);
    expect(after).not.toBe(before);
  });

  it("takes the signer's name from meta, so the review screen can show it before it is typed", () => {
    const unsigned = canonicalW9Text(complete({ signedName: "" }), {
      ...meta,
      signedName: "(not yet signed)",
    });
    expect(unsigned).toContain("Signed by: (not yet signed)");
    expect(canonicalW9Text(complete(), meta)).toContain("Signed by: Dana Ruiz");
  });

  it("spells out an LLC's elected classification rather than a letter code", () => {
    expect(
      classificationLabel(complete({ taxClassification: "llc", llcTaxClass: "S" }))
    ).toBe("Limited liability company, taxed as a S corporation");
  });
});

describe("signature evidence", () => {
  const meta = { signedName: "Dana Ruiz", signedAt: SIGNED_AT, companyName: "Ruiz Mechanical" };
  const text = canonicalW9Text(complete(), meta);

  it("reproduces for the same document and number", () => {
    const hash = w9DocHash(text, "412558890");
    expect(w9HashMatches(hash, text, "412558890")).toBe(true);
  });

  it("fails when the form was altered after signing", () => {
    const hash = w9DocHash(text, "412558890");
    const tampered = canonicalW9Text(complete({ address: "9 Other Street" }), meta);
    expect(w9HashMatches(hash, tampered, "412558890")).toBe(false);
  });

  it("fails when a different number is claimed against the same document", () => {
    const hash = w9DocHash(text, "412558890");
    expect(w9HashMatches(hash, text, "412558891")).toBe(false);
  });

  it("is keyed, so the hash alone cannot be brute-forced back to the number", () => {
    // A plain digest of the same inputs would be reproducible by anyone. This
    // one depends on the app secret, so a stolen database row is not enough.
    const withSecret = w9DocHash(text, "412558890");
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-different-secret";
    const withOther = w9DocHash(text, "412558890");
    process.env.AUTH_SECRET = original;
    expect(withOther).not.toBe(withSecret);
  });
});

describe("taxpayer numbers at rest", () => {
  it("round-trips through encryption", () => {
    const stored = encryptTin("412558890");
    expect(stored).not.toContain("412558890");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptTin(stored)).toBe("412558890");
  });

  it("produces a different ciphertext each time, so equal numbers are not obvious", () => {
    expect(encryptTin("412558890")).not.toBe(encryptTin("412558890"));
  });

  it("returns null rather than throwing on a corrupt or unreadable row", () => {
    expect(decryptTin("v1:garbage:garbage:garbage")).toBeNull();
    expect(decryptTin("not-a-ciphertext")).toBeNull();
    expect(decryptTin(null)).toBeNull();
  });
});
