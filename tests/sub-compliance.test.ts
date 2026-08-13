import { describe, it, expect } from "vitest";
import {
  currentStatus,
  isCurrent,
  assessCompliance,
  needs1099,
  signatureIsComplete,
  FORM_1099_THRESHOLD_CENTS,
  type ComplianceDoc,
} from "@/lib/domain/sub-compliance";

const NOW = new Date("2026-08-13T00:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const doc = (over: Partial<ComplianceDoc> = {}): ComplianceDoc => ({
  doc_type: "w9",
  status: "active",
  expires_at: null,
  signed_at: days(-10),
  verified_at: days(-9),
  ...over,
});

/**
 * The stored status is a cache written when the row was saved. A certificate
 * that lapsed yesterday still says "active" in the database, which is exactly
 * the failure this computes around.
 */
describe("expiry is computed, not trusted", () => {
  it("calls a lapsed certificate expired even when the row says active", () => {
    expect(currentStatus(doc({ status: "active", expires_at: days(-1) }), NOW)).toBe("expired");
  });

  it("flags one lapsing inside the window as expiring", () => {
    expect(currentStatus(doc({ expires_at: days(10) }), NOW)).toBe("expiring");
  });

  it("leaves one well in date as active", () => {
    expect(currentStatus(doc({ expires_at: days(200) }), NOW)).toBe("active");
  });

  it("treats a document with no expiry as active", () => {
    expect(currentStatus(doc({ expires_at: null }), NOW)).toBe("active");
  });

  it("keeps expiring documents usable, since coverage has not lapsed", () => {
    expect(isCurrent(doc({ expires_at: days(10) }), NOW)).toBe(true);
    expect(isCurrent(doc({ expires_at: days(-1) }), NOW)).toBe(false);
  });
});

describe("clearing a subcontractor for work", () => {
  const complete = (over: Partial<ComplianceDoc> = {}) => [
    doc({ doc_type: "w9", ...over }),
    doc({ doc_type: "coi_general_liability", expires_at: days(200), ...over }),
    doc({ doc_type: "coi_workers_comp", expires_at: days(200), ...over }),
  ];

  it("clears when W-9 and both certificates are current and verified", () => {
    const a = assessCompliance(complete(), NOW);
    expect(a.clearedForAward).toBe(true);
    expect(a.blockReason).toBeNull();
  });

  it("blocks when nothing is on file, and says what is missing", () => {
    const a = assessCompliance([], NOW);
    expect(a.clearedForAward).toBe(false);
    expect(a.missing).toHaveLength(3);
    expect(a.blockReason).toContain("W-9");
  });

  it("blocks on a lapsed certificate", () => {
    const docs = complete();
    docs[1] = doc({ doc_type: "coi_general_liability", expires_at: days(-1) });
    const a = assessCompliance(docs, NOW);
    expect(a.clearedForAward).toBe(false);
    expect(a.expired).toContain("coi_general_liability");
    expect(a.blockReason).toContain("lapsed");
  });

  it("blocks on an upload nobody has checked yet", () => {
    // An unverified upload is not evidence of coverage.
    const docs = complete();
    docs[0] = doc({ doc_type: "w9", verified_at: null });
    const a = assessCompliance(docs, NOW);
    expect(a.clearedForAward).toBe(false);
    expect(a.awaitingVerification).toContain("w9");
  });

  it("warns about an expiring certificate without blocking work", () => {
    const docs = complete();
    docs[1] = doc({ doc_type: "coi_general_liability", expires_at: days(10) });
    const a = assessCompliance(docs, NOW);
    expect(a.clearedForAward).toBe(true);
    expect(a.expiringSoon[0].docType).toBe("coi_general_liability");
  });

  it("prefers a current document over a rejected one kept for the audit trail", () => {
    const docs = [
      doc({ doc_type: "w9", status: "rejected" }),
      doc({ doc_type: "w9" }),
      doc({ doc_type: "coi_general_liability", expires_at: days(200) }),
      doc({ doc_type: "coi_workers_comp", expires_at: days(200) }),
    ];
    expect(assessCompliance(docs, NOW).clearedForAward).toBe(true);
  });
});

describe("1099 reporting", () => {
  it("triggers at the $600 threshold and not below", () => {
    expect(needs1099(FORM_1099_THRESHOLD_CENTS)).toBe(true);
    expect(needs1099(FORM_1099_THRESHOLD_CENTS - 1)).toBe(false);
  });
});

describe("electronic signature evidence", () => {
  it("requires a name, a time, and the hash of what was signed", () => {
    expect(
      signatureIsComplete({ signedName: "Jane Doe", signedAt: NOW, docHash: "abc" })
    ).toBe(true);
    expect(signatureIsComplete({ signedName: "  ", signedAt: NOW, docHash: "abc" })).toBe(false);
    expect(signatureIsComplete({ signedName: "Jane", signedAt: NOW })).toBe(false);
  });
});
