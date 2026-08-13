import { describe, it, expect } from "vitest";
import { assessCompliance, type ComplianceDoc } from "@/lib/domain/sub-compliance";
import { needsAttentionOnWonWork, type AwardComplianceRow } from "@/lib/sub-compliance-store";

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

const row = (docs: ComplianceDoc[], over: Partial<AwardComplianceRow> = {}): AwardComplianceRow => ({
  opportunityId: "opp",
  opportunityTitle: "Roof replacement, Building 42",
  contractId: "contract",
  orgId: null,
  subcontractorId: "sub",
  companyName: "Ruiz Mechanical",
  email: "dana@example.com",
  emailVerified: true,
  namedOnContract: true,
  assessment: assessCompliance(docs, NOW),
  ...over,
});

const complete = (over: Partial<ComplianceDoc> = {}) => [
  doc({ doc_type: "w9" }),
  doc({ doc_type: "coi_general_liability", expires_at: days(200), ...over }),
  doc({ doc_type: "coi_workers_comp", expires_at: days(200) }),
];

/**
 * The post-award gate is deliberately tighter than the pre-award one. Before a
 * win, an expiring certificate is a prompt and blocking outreach over it would
 * stop work for no reason. After a win the sub is on site, so a date a few
 * weeks out is something a person has to act on rather than note.
 */
describe("paperwork on work we have won", () => {
  it("leaves a fully covered sub alone", () => {
    expect(needsAttentionOnWonWork(row(complete()))).toBe(false);
  });

  it("raises a sub whose certificate expires soon, even though bidding would not", () => {
    const docs = complete({ expires_at: days(10) });
    const assessment = assessCompliance(docs, NOW);
    // The pre-award gate is satisfied.
    expect(assessment.clearedForAward).toBe(true);
    // The post-award one is not.
    expect(needsAttentionOnWonWork(row(docs))).toBe(true);
  });

  it("raises a lapsed certificate", () => {
    expect(needsAttentionOnWonWork(row(complete({ expires_at: days(-1) })))).toBe(true);
  });

  it("raises a sub with nothing on file", () => {
    expect(needsAttentionOnWonWork(row([]))).toBe(true);
  });

  it("raises an upload nobody has checked yet, since it is not evidence of cover", () => {
    const docs = complete();
    docs[1] = doc({ doc_type: "coi_general_liability", expires_at: days(200), verified_at: null });
    expect(needsAttentionOnWonWork(row(docs))).toBe(true);
  });

  /**
   * Whether a sub is chased automatically turns on this flag, so it is worth
   * pinning: a sub who quoted and was never designated is a question for the
   * operator, not an email telling them they are on a job they may have lost.
   */
  it("carries whether the contract names the sub, separately from their paperwork", () => {
    const quotedOnly = row(complete(), { namedOnContract: false });
    expect(quotedOnly.namedOnContract).toBe(false);
    expect(needsAttentionOnWonWork(quotedOnly)).toBe(false);
    expect(needsAttentionOnWonWork(row([], { namedOnContract: false }))).toBe(true);
  });
});
