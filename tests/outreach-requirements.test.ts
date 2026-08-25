/**
 * What a subcontractor is asked to price, and what it must satisfy to price it.
 *
 * The failures pinned here are all quiet ones: a scope that silently describes
 * the whole project to a single trade, a mandatory site visit that never
 * reaches the email, a condition filed as work, a requirement nobody wrote
 * down being helpfully invented.
 */
import { describe, it, expect } from "vitest";
import {
  buildOutreachRequirements,
  renderRequirementLines,
} from "@/lib/domain/outreach-requirements";

const ANALYSIS = {
  trade_scopes: [
    {
      trade: "HVAC",
      work:
        "Remove 12 existing rooftop units in Buildings 3 and 4.\n" +
        "Furnish and install 12 replacement units, 5 tons each.\n" +
        "Test and balance all air distribution before closeout.",
    },
    { trade: "Electrical", work: "Pull new feeders to the roof curbs." },
  ],
  bid_schedule: [
    { clin: "0001", description: "HVAC rooftop unit replacement", quantity: "12", unit: "EA" },
    { clin: "0002", description: "Interior painting", quantity: "4000", unit: "SF" },
  ],
  qualifications: {
    licenses: ["State mechanical contractor licence"],
    insurance: ["General liability, $2,000,000 per occurrence"],
    bonding: [],
  },
  site_visit: { required: true, details: "August 14, 2026, 9:00 AM, Building 3 lobby" },
  prebid_meeting: { required: false },
  special_requirements: [
    "Davis-Bacon prevailing wage rates apply to all trades.",
    "All debris must be removed and disposed of off site daily.",
    "Work restricted to hours of 7:00 AM to 3:30 PM, Monday through Friday.",
  ],
  submission_requirements: ["Quote must be submitted on the attached pricing schedule."],
  period_of_performance: "180 calendar days from notice to proceed",
  offer_acceptance_period: "60 days",
};

describe("trade scope", () => {
  it("describes this trade's work, not the whole project's", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    expect(r.tradeSpecific).toBe(true);
    const text = r.tradeScope.map((i) => i.text).join(" ");
    expect(text).toMatch(/rooftop units/i);
    // The electrician's work is not this subcontractor's problem to price.
    expect(text).not.toMatch(/feeders/i);
  });

  it("splits a multi-line scope into separate items", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    expect(r.tradeScope.filter((i) => i.source === "trade_scope").length).toBe(3);
  });

  it("attaches the agency's own line items, because that is where quantities live", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    const clin = r.tradeScope.find((i) => i.source === "bid_schedule");
    expect(clin?.text).toBe("0001: HVAC rooftop unit replacement (12 EA)");
  });

  it("does not attach a line item belonging to another trade", () => {
    /*
     * Pasting an unrelated CLIN into a scope invites a price for work someone
     * else is already covering, and the double-count survives into the bid.
     */
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    expect(r.tradeScope.map((i) => i.text).join(" ")).not.toMatch(/painting/i);
  });

  it("files disposal as work and wage rates as a condition", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    expect(r.tradeScope.map((i) => i.text).join(" ")).toMatch(/debris/i);
    expect(r.subRequirements.map((i) => i.text).join(" ")).toMatch(/davis-bacon/i);
    // And not the other way round.
    expect(r.tradeScope.map((i) => i.text).join(" ")).not.toMatch(/davis-bacon/i);
  });

  it("says so when it is describing the project rather than the trade", () => {
    const r = buildOutreachRequirements({
      trade: "Roofing",
      analysis: { ...ANALYSIS, trade_scopes: [] },
      description: "Replace mechanical equipment across the installation.",
    });
    expect(r.tradeSpecific).toBe(false);
    expect(r.gaps.join(" ")).toMatch(/no scope written specifically for Roofing/i);
  });

  it("warns when nothing in the scope carries a number", () => {
    const r = buildOutreachRequirements({
      trade: "Roofing",
      analysis: { trade_scopes: [{ trade: "Roofing", work: "Replace the roof membrane." }] },
    });
    expect(r.gaps.join(" ")).toMatch(/estimate rather than a quote/i);
  });
});

describe("subcontractor requirements", () => {
  it("carries the mandatory site visit with its date", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    const visit = r.subRequirements.find((i) => i.source === "site_visit");
    expect(visit?.mandatory).toBe(true);
    expect(visit?.text).toContain("August 14, 2026");
  });

  it("leaves out a site visit that is not required", () => {
    expect(
      buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS }).subRequirements.some(
        (i) => i.source === "prebid_meeting"
      )
    ).toBe(false);
  });

  it("flags a required site visit with no details, rather than inventing them", () => {
    const r = buildOutreachRequirements({
      trade: "HVAC",
      analysis: { ...ANALYSIS, site_visit: { required: true } },
    });
    expect(r.gaps.join(" ")).toMatch(/no date or location/i);
  });

  it("treats qualifications as prerequisites, because that is what they are", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    const licence = r.subRequirements.find((i) => i.text.startsWith("License:"));
    expect(licence?.mandatory).toBe(true);
    expect(licence?.text).toContain("mechanical contractor");
  });

  it("turns our acceptance period into their quote validity", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    expect(r.subRequirements.map((i) => i.text)).toContain(
      "Quote must remain valid for 60 days"
    );
  });

  it("keeps working hours, which change what a crew costs", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: ANALYSIS });
    expect(r.subRequirements.map((i) => i.text).join(" ")).toMatch(/7:00 AM to 3:30 PM/);
  });
});

describe("never inventing", () => {
  it("returns nothing at all from an empty analysis", () => {
    const r = buildOutreachRequirements({ trade: "HVAC", analysis: {} });
    expect(r.tradeScope).toEqual([]);
    expect(r.subRequirements).toEqual([]);
    expect(r.gaps.join(" ")).toMatch(/No scope could be assembled/i);
  });

  it("drops the analyst's not-specified placeholders instead of printing them", () => {
    /*
     * "Insurance: Not specified in the provided documents" in an email reads
     * as a requirement, and a subcontractor cannot tell it apart from one.
     */
    const r = buildOutreachRequirements({
      trade: "HVAC",
      analysis: {
        qualifications: { insurance: ["Not specified in the provided documents"] },
        period_of_performance: "TBD",
        offer_acceptance_period: "N/A",
      },
    });
    expect(r.subRequirements).toEqual([]);
  });

  it("does not read should or may as mandatory", () => {
    // Over-promising on a sub's behalf is how a quote gets withdrawn.
    const r = buildOutreachRequirements({
      trade: "HVAC",
      analysis: { special_requirements: ["Contractors may wish to carry additional insurance."] },
    });
    expect(r.subRequirements[0]?.mandatory).toBe(false);
  });

  it("says the same requirement once when two fields both carry it", () => {
    const r = buildOutreachRequirements({
      trade: "HVAC",
      analysis: {
        special_requirements: ["Quote must be submitted on the attached pricing schedule."],
        submission_requirements: ["Quote must be submitted on the attached pricing schedule."],
      },
    });
    expect(r.subRequirements.length).toBe(1);
  });
});

describe("renderRequirementLines", () => {
  it("marks what cannot be declined", () => {
    expect(
      renderRequirementLines([
        { text: "Site visit: August 14", mandatory: true, source: "site_visit" },
        { text: "Period of performance: 180 days", mandatory: false, source: "period_of_performance" },
      ])
    ).toEqual(["Site visit: August 14 (required)", "Period of performance: 180 days"]);
  });
});
