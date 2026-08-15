import { describe, it, expect } from "vitest";
import {
  buildOpportunityBrief,
  type OpportunityBriefInput,
} from "@/lib/domain/opportunity-brief";
import type { ComplianceRequirement } from "@/lib/types";

function matrixItem(over: Partial<ComplianceRequirement> = {}): ComplianceRequirement {
  return {
    id: "sf1449",
    title: "Signed SF-1449 (offer form)",
    category: "form",
    mandatory: true,
    source: "Section L.3",
    signature_required: true,
    satisfied_by: "operator_signature",
    ...over,
  };
}

function labels(b: ReturnType<typeof buildOpportunityBrief>): string[] {
  return b.requirements.map((r) => r.label);
}

describe("what it takes to bid", () => {
  it("says nothing when the analysis extracted nothing", () => {
    const b = buildOpportunityBrief({});
    expect(b.empty).toBe(true);
    expect(b.requirements).toEqual([]);
    expect(b.disqualifiers).toEqual([]);
  });

  it("carries the compliance matrix, which nothing rendered before a bid existed", () => {
    const b = buildOpportunityBrief({ complianceMatrix: [matrixItem()] });
    expect(labels(b)).toEqual(["Signed SF-1449 (offer form)"]);
    expect(b.requirements[0].source).toBe("Section L.3");
    expect(b.requirements[0].needsSignature).toBe(true);
  });

  it("separates what the platform produces from what only you can do", () => {
    const b = buildOpportunityBrief({
      complianceMatrix: [
        matrixItem({ id: "pricing", title: "Pricing schedule", satisfied_by: "auto_generated" }),
        matrixItem({ id: "bond", title: "Bid bond", satisfied_by: "operator_provided" }),
      ],
    });
    const byLabel = Object.fromEntries(b.requirements.map((r) => [r.label, r]));
    expect(byLabel["Pricing schedule"].owner).toBe("platform");
    expect(byLabel["Bid bond"].owner).toBe("you");
  });

  it("flags only the mandatory items a person can actually forget", () => {
    // A generated pricing schedule is mandatory too, but the operator cannot
    // drop it. Flagging it would bury the bond they have to go buy.
    const b = buildOpportunityBrief({
      complianceMatrix: [
        matrixItem({ id: "pricing", title: "Pricing schedule", satisfied_by: "auto_generated" }),
        matrixItem({ id: "bond", title: "Bid bond", satisfied_by: "operator_provided" }),
      ],
    });
    expect(b.disqualifiers.map((r) => r.label)).toEqual(["Bid bond"]);
  });

  it("explains why an official agency form cannot be substituted", () => {
    const b = buildOpportunityBrief({
      complianceMatrix: [matrixItem({ official_form: "SF-1449" })],
    });
    expect(b.requirements[0].disqualifyingReason).toMatch(/SF-1449 has to be used/);
  });

  it("does not treat an optional matrix row as required", () => {
    const b = buildOpportunityBrief({
      complianceMatrix: [matrixItem({ id: "x", title: "Sample brochure", mandatory: false })],
    });
    expect(b.requirements[0].importance).toBe("optional");
    expect(b.disqualifiers).toEqual([]);
  });
});

describe("merging the sources that restate each other", () => {
  it("collapses the same form stated three different ways", () => {
    const b = buildOpportunityBrief({
      complianceMatrix: [matrixItem()],
      requiredForms: [{ name: "SF-1449" }],
      submissionRequirements: ["Submit a completed and signed SF 1449."],
    });
    expect(labels(b)).toEqual(["Signed SF-1449 (offer form)"]);
  });

  it("merges a form named in the matrix with the instruction that restates it", () => {
    // Caught by rendering, not by the first version of these tests: the earlier
    // substring match compared "sf1449offer" against "offerorssf1449" and saw
    // two different obligations, so SF-1449 appeared twice in the same list.
    const b = buildOpportunityBrief({
      complianceMatrix: [matrixItem()],
      submissionRequirements: ["Offerors must submit a completed and signed SF 1449."],
    });
    expect(labels(b)).toEqual(["Signed SF-1449 (offer form)"]);
  });

  it("does not merge two different forms that both carry a number", () => {
    const b = buildOpportunityBrief({
      complianceMatrix: [matrixItem()],
      submissionRequirements: ["Offerors must submit a completed SF 33."],
    });
    expect(labels(b)).toHaveLength(2);
  });

  it("merges a restatement that adds no substance", () => {
    const b = buildOpportunityBrief({
      complianceMatrix: [
        matrixItem({ id: "b", title: "Product brochure for the proposed units" }),
      ],
      submissionRequirements: ["Provide a product brochure."],
    });
    expect(labels(b)).toEqual(["Product brochure for the proposed units"]);
  });

  it("keeps genuinely different requirements apart", () => {
    const b = buildOpportunityBrief({
      requiredForms: [{ name: "SF-1449" }, { name: "SF-33" }],
    });
    expect(labels(b)).toHaveLength(2);
  });

  it("does not let a short key swallow unrelated entries", () => {
    const b = buildOpportunityBrief({
      requiredForms: [{ name: "W-9" }, { name: "Certificate of insurance" }],
    });
    expect(labels(b)).toHaveLength(2);
  });
});

describe("reading the solicitation's own language", () => {
  it("treats must and shall as required", () => {
    const b = buildOpportunityBrief({
      submissionRequirements: ["Offerors must submit three hard copies."],
    });
    expect(b.requirements[0].importance).toBe("required");
    expect(b.requirements[0].disqualifying).toBe(true);
  });

  it("treats should and encouraged as recommended, not required", () => {
    const b = buildOpportunityBrief({
      submissionRequirements: ["Offerors are encouraged to include a capability statement."],
    });
    expect(b.requirements[0].importance).toBe("recommended");
    expect(b.requirements[0].disqualifying).toBe(false);
  });

  it("treats may and if applicable as optional", () => {
    const b = buildOpportunityBrief({
      submissionRequirements: ["Offerors may include past project photographs, if applicable."],
    });
    expect(b.requirements[0].importance).toBe("optional");
  });

  it("defaults an unhedged instruction to required", () => {
    // Guessing "optional" on a bare instruction is the dangerous direction.
    const b = buildOpportunityBrief({
      submissionRequirements: ["Pricing on the attached schedule, one line per item."],
    });
    expect(b.requirements[0].importance).toBe("required");
  });
});

describe("the things that get a good bid thrown out", () => {
  it("treats a mandatory site visit as disqualifying", () => {
    const b = buildOpportunityBrief({
      siteVisit: { required: true, details: "Sep 8, 9am, main gate" },
    });
    expect(b.requirements[0].label).toMatch(/attendance required/);
    expect(b.disqualifiers).toHaveLength(1);
    expect(b.disqualifiers[0].disqualifyingReason).toMatch(/not evaluated/);
  });

  it("leaves an optional site visit out of the disqualifiers", () => {
    const b = buildOpportunityBrief({ siteVisit: { required: false } });
    expect(b.requirements[0].importance).toBe("optional");
    expect(b.disqualifiers).toEqual([]);
  });

  it("treats a licence or certification as eligibility, not paperwork", () => {
    const b = buildOpportunityBrief({
      qualifications: { licenses: ["Active Georgia mechanical contractor licence"] },
    });
    expect(b.disqualifiers).toHaveLength(1);
    expect(b.disqualifiers[0].disqualifyingReason).toMatch(/however good the price/);
  });

  it("puts the fatal items above the routine ones", () => {
    const b = buildOpportunityBrief({
      complianceMatrix: [
        matrixItem({ id: "a", title: "Cover letter", satisfied_by: "auto_generated" }),
        matrixItem({ id: "b", title: "Bid bond", satisfied_by: "operator_provided" }),
      ],
    });
    expect(labels(b)[0]).toBe("Bid bond");
  });
});

describe("plain language for a first-time bidder", () => {
  it("explains a form number nobody outside government knows", () => {
    const b = buildOpportunityBrief({ requiredForms: [{ name: "SF-1449" }] });
    expect(b.requirements[0].explain).toMatch(/standard federal order form/i);
  });

  it("warns that an unacknowledged amendment gets bids rejected", () => {
    const b = buildOpportunityBrief({
      submissionRequirements: ["Acknowledge all amendments in Block 14."],
    });
    expect(b.requirements[0].explain).toMatch(/common reason bids are rejected/i);
  });

  it("explains wage determinations, which change what subs must be paid", () => {
    const b = buildOpportunityBrief({
      specialRequirements: ["Davis-Bacon wage determination applies to all site labor."],
    });
    expect(b.requirements[0].explain).toMatch(/minimum wages/i);
  });

  it("leaves ordinary English unannotated", () => {
    const b = buildOpportunityBrief({
      submissionRequirements: ["Email the quote to the address below."],
    });
    expect(b.requirements[0].explain).toBeUndefined();
  });

  it("classifies special requirements as context rather than deliverables", () => {
    const b = buildOpportunityBrief({
      specialRequirements: ["Work occurs between 6pm and 6am."],
    });
    expect(b.requirements[0].importance).toBe("info");
    expect(b.requirements[0].disqualifying).toBe(false);
  });

  it("keeps a condition out of the required list even when it says must", () => {
    // Also caught by rendering: "Work must occur between 6pm and 6am" was filed
    // under required items, telling the reader to go submit something when
    // there is nothing to submit.
    const b = buildOpportunityBrief({
      specialRequirements: ["Work must occur between 6pm and 6am."],
    });
    expect(b.requirements[0].importance).toBe("info");
    expect(b.counts.required).toBe(0);
  });
});

describe("counts drive the summary line", () => {
  it("tallies each band", () => {
    const input: OpportunityBriefInput = {
      complianceMatrix: [matrixItem()],
      submissionRequirements: [
        "Offerors are encouraged to include references.",
        "Offerors may attach photographs.",
      ],
      specialRequirements: ["Night work only."],
    };
    const b = buildOpportunityBrief(input);
    expect(b.counts).toEqual({ required: 1, recommended: 1, optional: 1, info: 1 });
    expect(b.empty).toBe(false);
  });

  it("ignores placeholder text the extractor leaves behind", () => {
    const b = buildOpportunityBrief({
      submissionRequirements: ["Not specified in the provided documents", "N/A", ""],
      requiredForms: [{ name: "None" }],
    });
    expect(b.empty).toBe(true);
  });
});
