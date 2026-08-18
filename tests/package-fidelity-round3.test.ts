/**
 * Third pass over "the package matches THIS solicitation exactly".
 *
 * Each of these covers a way the assembled package could disagree with the
 * solicitation, or with itself, while every status on screen read green.
 */
import { describe, it, expect } from "vitest";
import {
  resolveRequirements,
  buildManifest,
  pageLimitFrom,
  type ResolveContext,
} from "../lib/domain/package";
import { enclosureList } from "../lib/agents/package-builder";
import { documents } from "../lib/integrations/documents";
import { extractPdfText } from "../lib/integrations/pdf";
import type { ComplianceRequirement } from "../lib/types";

const ctx: ResolveContext = { confirmed: new Set(), hasNarrative: true, hasIdentifiers: true };

function req(p: Partial<ComplianceRequirement>): ComplianceRequirement {
  return {
    id: p.id ?? "x",
    title: p.title ?? "Item",
    category: p.category ?? "other",
    mandatory: p.mandatory ?? true,
    source: p.source ?? "L.1",
    signature_required: p.signature_required ?? false,
    satisfied_by: p.satisfied_by ?? "operator_provided",
    instructions: p.instructions,
    format: p.format,
    official_form: p.official_form,
  };
}

describe("the agency's own bid schedule", () => {
  const pricing = req({
    id: "sched",
    title: "Bid schedule",
    category: "pricing",
    satisfied_by: "auto_generated",
  });

  it("is the operator's to price when the agency enumerates its own lines", () => {
    // Spreading one trade-based total across CLINs nobody priced would be
    // inventing numbers on a priced offer.
    const r = resolveRequirements([pricing], { ...ctx, agencyScheduleLines: 4 });
    expect(r[0].status).toBe("needs_operator");
    expect(r[0].note).toContain("4 line items");
    // The generated worksheet is still attached, so they fill in the right
    // document rather than writing one.
    expect(r[0].artifact_kind).toBe("pricing_schedule");
  });

  it("stays ours when the solicitation states no line items, or exactly one", () => {
    expect(resolveRequirements([pricing], { ...ctx, agencyScheduleLines: 0 })[0].status).toBe(
      "satisfied"
    );
    expect(resolveRequirements([pricing], { ...ctx, agencyScheduleLines: 1 })[0].status).toBe(
      "satisfied"
    );
  });

  it("renders the agency's lines verbatim, priced only when there is one", async () => {
    const schedule = [
      { clin: "0001", description: "Base year roof replacement", quantity: "1", unit: "LS" },
      { clin: "0002", description: "Option year 1 maintenance", quantity: "12", unit: "MO" },
    ];
    const multi = await extractPdfText(
      await documents.buildPricingSchedulePdf({
        company_name: "Brost Co",
        opportunity_title: "Reroof Building 4",
        line_items: [{ label: "Roofing", amount: 122_000 }],
        bid_amount: 122_000,
        agency_schedule: schedule,
      }),
      200_000
    );
    expect(multi.text).toContain("0001");
    expect(multi.text).toContain("Base year roof replacement");
    expect(multi.text).toContain("Option year 1 maintenance");
    // Our trade rollup is NOT presented as the agency's schedule.
    expect(multi.text).not.toContain("Roofing");
    // No number is written against a line nobody priced.
    expect(multi.text).toMatch(/\$ _+/);

    const single = await extractPdfText(
      await documents.buildPricingSchedulePdf({
        company_name: "Brost Co",
        opportunity_title: "Reroof Building 4",
        line_items: [{ label: "Roofing", amount: 122_000 }],
        bid_amount: 122_000,
        agency_schedule: [schedule[0]],
      }),
      200_000
    );
    // One line is unambiguous: writing the number in is the price, not an
    // allocation.
    expect(single.text).not.toMatch(/\$ _+/);
    expect(single.text).toContain("122,000.00");
  });
});

describe("pageLimitFrom", () => {
  it("reads a limit however the solicitation phrased it", () => {
    expect(pageLimitFrom("10 pages maximum")).toBe(10);
    expect(pageLimitFrom("Maximum of 5 pages, 12 point font")).toBe(5);
    expect(pageLimitFrom("no more than 20 pages")).toBe(20);
    expect(pageLimitFrom("Not to exceed ten pages")).toBe(10);
    expect(pageLimitFrom("Page limit: 15")).toBe(15);
    expect(pageLimitFrom("limited to 3 pages")).toBe(3);
  });

  it("returns nothing rather than a guess", () => {
    // Refusing a compliant document is as bad as accepting an over-length one.
    expect(pageLimitFrom("PDF, single sided")).toBeNull();
    expect(pageLimitFrom("Use 8.5 x 11 paper")).toBeNull();
    expect(pageLimitFrom("")).toBeNull();
    expect(pageLimitFrom(undefined)).toBeNull();
  });
});

describe("the manifest names requirements in plain English", () => {
  it("carries the solicitation's own wording, not just a slug", () => {
    const m = buildManifest(
      resolveRequirements(
        [req({ id: "bond", title: "Bid bond at 20% of the offered price" })],
        ctx
      ),
      "W912DY-26-R-0007"
    );
    expect(m[0].title).toBe("Priced offer");
    expect(m[1].title).toBe("Bid bond at 20% of the offered price");
  });
});

describe("the compliance checklist is not part of the offer", () => {
  it("is never certified as enclosed", () => {
    // Its rows say things like "You must provide this". That is a page for
    // the operator, not for a contracting officer.
    const list = enclosureList(
      resolveRequirements(
        [req({ id: "p", title: "Pricing schedule", category: "pricing", satisfied_by: "auto_generated" })],
        ctx
      )
    );
    expect(list).toContain("Priced offer");
    expect(list).toContain("Pricing schedule");
    expect(list.some((l) => /checklist/i.test(l))).toBe(false);
  });
});

describe("format rules we cannot silently meet", () => {
  it("catches a file naming convention", () => {
    // Some agencies reject on the filename alone. We name by requirement and
    // solicitation, which is a sensible default and not their convention.
    const r = resolveRequirements(
      [
        req({
          id: "tech",
          title: "Cover letter",
          category: "narrative",
          satisfied_by: "auto_generated",
          format: "Name the file LastName_SolNo_VolI.pdf",
        }),
      ],
      ctx
    );
    expect(r[0].status).toBe("needs_operator");
    expect(r[0].note).toContain("file naming rule");
    expect(r[0].note).toContain("LastName_SolNo_VolI.pdf");
  });
});
