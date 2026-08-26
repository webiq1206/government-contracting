/**
 * A quote request must not describe the whole project.
 *
 * resolveSubWork falls back when the analyst wrote no scope for a trade:
 * draft_sow, then scope_plain_language, then project_overview, then the raw
 * notice description. Every one of those describes the WHOLE job. It reports
 * which it used through `tradeSpecific`.
 *
 * That flag reached a `gaps` note, which is a line an operator might read
 * later, and the send went ahead. So a roofer could receive a quote request
 * describing electrical, mechanical, sitework and roofing together. They
 * either price work three other trades are covering, which makes the number
 * useless, or they read it as sent to the wrong company and stop replying.
 * The second one costs the relationship, not just the bid.
 *
 * validateOutboundEmail is the last gate before a real send, and it now
 * refuses.
 */
import { describe, it, expect } from "vitest";
import { validateOutboundEmail } from "../lib/domain/outreach-validation";

const BASE = {
  subject: "Quote request",
  body: "Hello, please price the attached work by Friday.",
  vars: {} as Record<string, string>,
  missingRequired: [] as string[],
  attachedNames: ["solicitation.pdf"],
  documentsExpected: true,
};

const kinds = (p: ReturnType<typeof validateOutboundEmail>) => p.map((x) => x.kind);

describe("the trade-scope send gate", () => {
  it("refuses a trade-specific request built from a project-wide scope", () => {
    const problems = validateOutboundEmail({ ...BASE, trade: "Roofing", tradeSpecific: false });
    expect(kinds(problems)).toContain("trade_scope_not_ready");
  });

  it("names the trade, so the operator knows which packet is not ready", () => {
    const [problem] = validateOutboundEmail({ ...BASE, trade: "Roofing", tradeSpecific: false });
    expect(problem.message).toContain("Roofing");
    // And says what goes wrong, not merely that something is wrong.
    expect(problem.message).toMatch(/other trades are covering/);
  });

  it("allows a request whose scope really is this trade's", () => {
    const problems = validateOutboundEmail({ ...BASE, trade: "Roofing", tradeSpecific: true });
    expect(kinds(problems)).not.toContain("trade_scope_not_ready");
  });

  it("does not block a request that names no trade at all", () => {
    /*
     * A general enquiry is legitimately about the whole project and has
     * nothing to be specific to. Blocking it would be the over-correction:
     * a gate that stops correct work is a gate people route around.
     */
    const problems = validateOutboundEmail({ ...BASE, trade: null, tradeSpecific: false });
    expect(kinds(problems)).not.toContain("trade_scope_not_ready");
  });

  it("does not block when the caller says nothing about specificity", () => {
    // Absent is not false. An older caller that has not been updated must not
    // start failing every send; it should keep its previous behaviour.
    const problems = validateOutboundEmail({ ...BASE, trade: "Roofing" });
    expect(kinds(problems)).not.toContain("trade_scope_not_ready");
  });

  it("still reports the other problems it always did", () => {
    // The new check must not shadow the existing ones.
    const problems = validateOutboundEmail({
      ...BASE,
      body: "Hello {{owner_name}}, please price this.",
      attachedNames: [],
      trade: "Roofing",
      tradeSpecific: false,
    });
    expect(kinds(problems)).toEqual(
      expect.arrayContaining(["unresolved_token", "trade_scope_not_ready", "no_attachments"])
    );
  });
});
