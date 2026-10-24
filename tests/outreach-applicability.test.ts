import { describe, expect, it } from "vitest";
import { RequirementApplicabilitySchema, groundRequirementApplicability, decideRequirementApplicability, type RequirementApplicability } from "@/lib/domain/outreach-applicability";
import { buildOutreachRequirements, renderRequirementLines } from "@/lib/domain/outreach-requirements";
import { validateOutboundEmail } from "@/lib/domain/outreach-validation";

const prime = "Prime offeror must submit an SF24 bid guarantee.";
const plumbing = "The Plumbing subcontractor must hold a state plumbing license.";
const shared = "All subcontractors must carry general liability insurance.";
function record(text: string, options: Partial<RequirementApplicability> = {}): RequirementApplicability {
  return { requirement: text, source: "qualifications", applies_to: "subcontractor",
    trades: ["Plumbing"], all_trades: false, mandatory: true, source_quote: text,
    source_document: "Synthetic source.pdf", source_page: 1, ...options };
}
function ground(records: RequirementApplicability[], text = records.map(r => r.source_quote).join("\n")) {
  return groundRequirementApplicability(records, [{ id: "synthetic-doc", name: "Synthetic source.pdf", text, pageCount: 1, pageTexts: [text] }], "");
}
function decide(r: RequirementApplicability, trade = "Plumbing") {
  return decideRequirementApplicability({ text: r.requirement, source: r.source, trade, records: [r] });
}

describe("source grounding and party applicability", () => {
  it("never accepts a model's claim of verified evidence", () => {
    const parsed = RequirementApplicabilitySchema.parse({ ...record(plumbing), evidence_verified: true });
    expect(parsed).not.toHaveProperty("evidence_verified");
    expect(ground([parsed], "A different obligation.")[0].evidence_verified).toBe(false);
  });
  it("rejects a real citation whose quote does not support the requirement", () => {
    expect(ground([record("The Plumbing subcontractor must be certified SDVOSB.", { source_quote: plumbing })])[0].evidence_verified).toBe(false);
  });
  it("does not reuse a missing document or stale amendment excerpt", () => {
    const r = ground([record(plumbing)], "The current amendment contains different terms.")[0];
    expect(decide(r).kind).toBe("review");
    expect(ground([record(plumbing, { source_document: "Missing amendment.pdf" })])[0].evidence_verified).toBe(false);
  });
  it("accepts a verbatim notice obligation without inventing a document anchor", () => {
    const [r] = groundRequirementApplicability([record(shared, { source_document: undefined, source_page: undefined, all_trades: true })], [], shared);
    expect(r.source_document_id).toBeUndefined();
    expect(decide(r)).toEqual({ kind: "include", mandatory: true });
  });
  it("separates prime duties from sourced trade and shared obligations", () => {
    const requirements = [record(prime, { applies_to: "prime", trades: [] }), record(plumbing), record(shared, { applies_to: "shared", all_trades: true })];
    const r = buildOutreachRequirements({ trade: "Plumbing", analysis: {
      qualifications: { bonding: [prime], licenses: [plumbing], insurance: [shared] },
      requirement_applicability: ground(requirements),
    } });
    expect(r.primeRequirements).toEqual([{ text: `Bonding: ${prime}`, source: "qualifications", mandatory: true }]);
    expect(renderRequirementLines(r.subRequirements).join("\n")).toContain(plumbing);
    expect(renderRequirementLines(r.subRequirements).join("\n")).toContain(shared);
    expect(renderRequirementLines(r.subRequirements).join("\n")).not.toContain("SF24");
    expect(r.reviewRequired).toEqual([]);
  });
  it("retains a separately sourced subcontract bond", () => {
    const text = "The Plumbing subcontractor must furnish a performance bond for this subcontract.";
    expect(decide(ground([record(text)])[0])).toEqual({ kind: "include", mandatory: true });
  });
  it("retains an explicit package certification requirement without generalizing it", () => {
    const text = "The Plumbing subcontractor must be certified SDVOSB for this subcontract package.";
    const [r] = ground([record(text)]);
    expect(decide(r)).toEqual({ kind: "include", mandatory: true });
    expect(decide(r, "Electrical")).toEqual({ kind: "other_trade" });
  });
  it.each(["if selected", "subject to the package restriction", "for a similarly situated preference"])("holds a conditional obligation: %s", condition => {
    const text = `The Plumbing subcontractor must be certified SDVOSB ${condition}.`;
    expect(decide(ground([record(text)])[0]).kind).toBe("review");
  });
  it("cannot relabel a prime quote as a subcontract obligation", () => {
    expect(decide(ground([record(prime)])[0]).kind).toBe("review");
  });
  it("cannot omit a shared obligation by relabeling it prime", () => {
    expect(decide(ground([record(shared, { applies_to: "prime" })])[0]).kind).toBe("review");
  });
  it("requires an explicit all-trades statement, not a guessed scope", () => {
    expect(decide(ground([record(plumbing, { all_trades: true })])[0], "Electrical").kind).toBe("review");
  });
  it("does not turn a mention of another trade into an obligation for it", () => {
    const text = "The Electrical subcontractor must coordinate with Plumbing before testing.";
    expect(decide(ground([record(text)])[0]).kind).toBe("review");
  });
  it("holds exclusions instead of interpreting them as blanket coverage", () => {
    const text = "All subcontractors except Plumbing must carry this certification.";
    expect(decide(ground([record(text, { all_trades: true })])[0]).kind).toBe("review");
  });
  it("does not silently make an optional qualification mandatory", () => {
    const text = "The Plumbing subcontractor may carry additional insurance.";
    expect(decide(ground([record(text)])[0]).kind).toBe("review");
    expect(decide(ground([record(text, { mandatory: false })])[0])).toEqual({ kind: "include", mandatory: false });
  });
  it("does not choose between conflicting applicability records", () => {
    const [r] = ground([record(plumbing)]);
    expect(decideRequirementApplicability({ text: plumbing, source: "qualifications", trade: "Plumbing", records: [r, { ...r, applies_to: "prime" }] }).kind).toBe("review");
  });
  it("checks prime duties filed under scope-shaped special or submission requirements", () => {
    const special = "Prime offeror must provide LOS certification.";
    const submission = "Bidder must provide five copies of its proposal.";
    const r = buildOutreachRequirements({ trade: "Plumbing", analysis: {
      special_requirements: [special], submission_requirements: [submission],
      requirement_applicability: ground([
        record(special, { source: "special_requirements", applies_to: "prime" }),
        record(submission, { source: "submission", applies_to: "prime" }),
      ]),
    } });
    expect(r.tradeScope).toEqual([]);
    expect(r.subRequirements).toEqual([]);
    expect(r.primeRequirements).toHaveLength(2);
  });
  it("holds unscoped LOS text without dropping the obligation", () => {
    const text = "Limitations on subcontracting: 85 percent excluding materials.";
    const r = buildOutreachRequirements({ trade: "Plumbing", analysis: { special_requirements: [text] } });
    expect(r.reviewRequired.map(r => r.text)).toContain(text);
  });
  it("holds even a single-trade legacy invitation and blocks final send validation", () => {
    const r = buildOutreachRequirements({ trade: "Plumbing", analysis: {
      trade_scopes: [{ trade: "Plumbing", work: "Install 2 fixtures." }],
      qualifications: { licenses: [plumbing] },
    } });
    expect(r.subRequirements).toEqual([]);
    expect(r.reviewRequired).toHaveLength(1);
    expect(validateOutboundEmail({ subject: "Pricing request", body: "Install 2 fixtures.", vars: {}, missingRequired: [], attachedNames: [], documentsExpected: false,
      requirementReviewRequired: r.reviewRequired }).some(p => p.kind === "requirement_applicability")).toBe(true);
  });
});
