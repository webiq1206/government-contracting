/**
 * What actually leaves the building.
 *
 * These render the real PDFs and read the text back, because the failures
 * here are not type errors: the bid PDF printed our target margin in bold
 * under the price, the pricing schedule carried a line naming our markup
 * percentage and the margin it prices to, and the cover letter certified
 * documents as enclosed that nobody had produced. Every one of those goes to
 * the contracting officer.
 */
import { describe, it, expect } from "vitest";
import { documents } from "../lib/integrations/documents";
import { extractPdfText } from "../lib/integrations/pdf";
import { offerLineItems } from "../lib/domain/pricing";

async function textOf(buf: Buffer): Promise<string> {
  const { text } = await extractPdfText(buf, 200_000);
  return text;
}

describe("offerLineItems", () => {
  it("carries the markup inside the scope lines and still totals the bid", () => {
    const items = offerLineItems(
      [
        { label: "Electrical", amount: 40_000 },
        { label: "Roofing", amount: 60_000 },
      ],
      122_000
    );
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.label)).toEqual(["Electrical", "Roofing"]);
    const total = items.reduce((s, i) => s + i.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(122_000);
    // Nothing names a markup or a margin.
    expect(items.some((i) => /markup|margin/i.test(i.label))).toBe(false);
  });

  it("absorbs rounding drift so the lines add up to the cent", () => {
    const items = offerLineItems(
      [
        { label: "A", amount: 1 },
        { label: "B", amount: 1 },
        { label: "C", amount: 1 },
      ],
      100
    );
    expect(Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100).toBe(100);
  });

  it("leaves the lines alone when there is nothing to distribute", () => {
    expect(offerLineItems([], 100)).toEqual([]);
    expect(offerLineItems([{ label: "A", amount: 0 }], 100)).toEqual([{ label: "A", amount: 0 }]);
  });
});

describe("the submitted bid PDF", () => {
  it("does not disclose our margin or our internal review checklist", async () => {
    const buf = await documents.buildBidPdf({
      company_name: "Brost Co",
      opportunity_title: "Reroof Building 4",
      solicitation_number: "W912DY-26-R-0007",
      agency: "US Army Corps of Engineers",
      bid_amount: 122_000,
      margin_pct: 22,
      line_items: offerLineItems(
        [
          { label: "Electrical", amount: 40_000 },
          { label: "Roofing", amount: 60_000 },
        ],
        122_000
      ),
      qa_checklist: [
        { item: "Bonding capacity confirmed", ok: false, note: "no bonding on file" },
      ],
    });
    const text = await textOf(buf);

    expect(text).toContain("Reroof Building 4");
    expect(text).toContain("Total Bid Amount");
    // The three things a contracting officer must never read off our offer.
    expect(text).not.toMatch(/target margin/i);
    expect(text).not.toMatch(/markup/i);
    expect(text).not.toMatch(/quality assurance checklist/i);
    expect(text).not.toMatch(/no bonding on file/i);
  });
});

describe("the submitted pricing schedule", () => {
  it("prices the scope without naming our markup or our cost basis", async () => {
    const buf = await documents.buildPricingSchedulePdf({
      company_name: "Brost Co",
      opportunity_title: "Reroof Building 4",
      solicitation_number: "W912DY-26-R-0007",
      line_items: offerLineItems(
        [
          { label: "Electrical", amount: 40_000 },
          { label: "Roofing", amount: 60_000 },
        ],
        122_000
      ),
      bid_amount: 122_000,
    });
    const text = await textOf(buf);
    expect(text).toContain("Electrical");
    expect(text).toContain("Roofing");
    expect(text).toMatch(/TOTAL PROPOSED PRICE/);
    expect(text).not.toMatch(/markup/i);
    expect(text).not.toMatch(/target margin/i);
    // The sub's own quote number is our cost basis, and it is not in here.
    expect(text).not.toContain("40,000.00");
  });
});

describe("the reps & certs data sheet", () => {
  it("does not certify a size status that is not on file", async () => {
    const buf = await documents.buildRepsAndCertsPdf({
      legal_name: "Brost Co",
      certifications: [],
      naics_codes: ["238160"],
      // A profile saved before the field existed reads back undefined, and
      // this used to print "No" on a document the owner signs.
      small_business: undefined,
    });
    const text = await textOf(buf);
    expect(text).toMatch(/NOT ON FILE/);
  });

  it("still certifies a real answer when there is one", async () => {
    const yes = await textOf(
      await documents.buildRepsAndCertsPdf({
        legal_name: "Brost Co",
        certifications: [],
        naics_codes: [],
        small_business: true,
      })
    );
    expect(yes).toMatch(/Small business\s*Yes/);
  });
});

describe("the capability statement", () => {
  it("does not claim past performance it cannot show", async () => {
    const text = await textOf(
      await documents.buildCapabilityStatementPdf({
        company_name: "Brost Co",
        naics_codes: [],
        certifications: [],
        primary_trades: ["Roofing"],
        service_areas: ["MA"],
      })
    );
    expect(text).not.toMatch(/available upon request/i);
  });
});

describe("solicitation-specific data on the offer", () => {
  it("states the offeror, the work and how long the price stands", async () => {
    const buf = await documents.buildCoverLetterPdf({
      company_name: "Brost Co",
      opportunity_title: "Reroof Building 4",
      solicitation_number: "W912DY-26-R-0007",
      agency: "US Army Corps of Engineers",
      bid_amount: 122_000,
      contents: ["Priced offer", "Compliance checklist"],
      uei: "ABC123DEF456",
      cage_code: "1A2B3",
      naics_code: "238160",
      set_aside: "Total Small Business Set-Aside",
      place_of_performance: "Fort Devens, Ayer, MA",
      period_of_performance: "180 calendar days after notice to proceed",
      offer_acceptance_period: "30 calendar days",
      amendments_acknowledged: ["Amendment 0001", "Amendment 0002"],
    });
    const text = await textOf(buf);
    expect(text).toContain("ABC123DEF456");
    expect(text).toContain("1A2B3");
    expect(text).toContain("238160");
    expect(text).toContain("Total Small Business Set-Aside");
    expect(text).toContain("Fort Devens");
    expect(text).toContain("180 calendar days after notice to proceed");
    expect(text).toMatch(/firm and open for acceptance for 30 calendar days/);
    expect(text).toMatch(/acknowledges receipt of the following amendments: Amendment 0001, Amendment 0002/);
  });

  it("prints no line at all for a fact the solicitation never stated", async () => {
    const text = await textOf(
      await documents.buildCoverLetterPdf({
        company_name: "Brost Co",
        opportunity_title: "Reroof Building 4",
        bid_amount: 122_000,
        contents: ["Priced offer"],
      })
    );
    // Never a "Not specified" or an invented customary default.
    expect(text).not.toMatch(/not specified/i);
    expect(text).not.toMatch(/period of performance/i);
    expect(text).not.toMatch(/firm and open for acceptance/i);
    expect(text).not.toMatch(/60 days/);
  });

  it("carries the terms onto the pricing schedule too", async () => {
    const text = await textOf(
      await documents.buildPricingSchedulePdf({
        company_name: "Brost Co",
        opportunity_title: "Reroof Building 4",
        line_items: [{ label: "Roofing", amount: 122_000 }],
        bid_amount: 122_000,
        period_of_performance: "180 calendar days after notice to proceed",
        offer_acceptance_period: "30 calendar days",
        amendments_acknowledged: ["Amendment 0001"],
      })
    );
    expect(text).toMatch(/Period of performance/);
    expect(text).toMatch(/Price firm for/);
    expect(text).toMatch(/Amendment 0001/);
  });
});

describe("the compliance checklist cover page", () => {
  it("states the format rule and the required form on the page a person checks", async () => {
    const text = await textOf(
      await documents.buildComplianceMatrixPdf({
        opportunity_title: "Reroof Building 4",
        solicitation_number: "W912DY-26-R-0007",
        company_name: "Brost Co",
        rows: [
          {
            title: "Technical approach",
            status: "You must provide this",
            complete: false,
            mandatory: true,
            source: "Section L.3",
            format: "10 pages maximum, 12 point Times New Roman",
          },
          {
            title: "Offer form",
            status: "Prefilled, needs signature",
            complete: false,
            mandatory: true,
            source: "Section A",
            official_form: "SF-1449",
          },
        ],
      })
    );
    expect(text).toContain("10 pages maximum");
    expect(text).toMatch(/Must be the official SF-1449/);
  });
});
