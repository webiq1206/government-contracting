import { expect, it } from "vitest";
import { buildOutreachRequirements, renderRequirementLines } from "@/lib/domain/outreach-requirements";

it("does not turn unscoped prime qualifications into mandatory plumbing credentials", () => {
  const result = buildOutreachRequirements({ trade: "Plumbing", analysis: {
    trade_scopes: [{ trade: "Plumbing", work: "Replace 2 fixtures." }],
    qualifications: {
      certifications: ["Prime offeror must be certified SDVOSB."],
      bonding: ["Offeror must submit the SF24 bid guarantee."],
      other: ["Prime contractor must submit LOS certification."],
    },
  } });
  expect(renderRequirementLines(result.subRequirements).join("\n")).not.toMatch(/SDVOSB|SF24|LOS/);
  expect(result.reviewRequired).toHaveLength(3);
});
