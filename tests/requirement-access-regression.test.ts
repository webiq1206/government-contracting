import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
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

it("lets a signed-out document recipient reach the token authorizer", () => {
  const response = middleware(new NextRequest("https://brostco.com/d/synthetic.invalid"));
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});
