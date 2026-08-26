/**
 * A subcontractor must not be asked to price another trade's work.
 *
 * The filter meant to prevent it was unreachable:
 *
 *   if (!SCOPE_RE.test(text)) continue;
 *   if (trade && !mentionsTrade(text, trade) && !SCOPE_RE.test(text)) continue;
 *
 * The first line guarantees SCOPE_RE matches, so the second line's
 * `!SCOPE_RE.test(text)` is always false, the `&&` chain is always false, and
 * the `continue` never executed. Every scope-shaped special requirement went
 * to every trade.
 *
 * What that costs: the roofer opens a quote request listing "all electrical
 * conduit shall be tested and certified" as work to price. They either price
 * it, and the number is unusable, or they conclude the request was not meant
 * for them and stop replying. Both lose the trade.
 *
 * The obvious repair over-corrects, which is why these tests check both
 * directions rather than only the leak.
 */
import { describe, it, expect } from "vitest";
import { buildOutreachRequirements } from "../lib/domain/outreach-requirements";

const ANALYSIS = {
  trade_scopes: [
    { trade: "Roofing", work: "Remove and replace the built-up roof on Building 402." },
    { trade: "Electrical", work: "Install new branch circuits and panels." },
    { trade: "HVAC", work: "Replace four rooftop units." },
  ],
  special_requirements: [
    // Scope-shaped and names another trade. Must not reach the roofer.
    // "install" matches SCOPE_RE and nothing here matches CONDITION_RE.
    "Install new electrical conduit throughout Building 402.",
    // Scope-shaped and names the roofer's own trade. Must reach them.
    "Roofing debris shall be removed from the site daily.",
    // Scope-shaped and names nobody. Applies to everyone.
    "All work areas shall be cleaned at the end of each shift.",
    // Condition-shaped and names another trade. Must not reach the roofer.
    // "licen" matches CONDITION_RE, so this lands in subRequirements.
    "Electrical work shall be performed by a licensed master electrician.",
    // Condition-shaped and names nobody. Must reach everyone.
    "Davis-Bacon prevailing wage determination applies to all site labor.",
  ],
};

function scopeTextFor(trade: string): string {
  return buildOutreachRequirements({ trade, analysis: ANALYSIS })
    .tradeScope.map((i) => i.text)
    .join(" | ");
}

/** The conditions list, which had no ownership test at all. */
function conditionTextFor(trade: string): string {
  return buildOutreachRequirements({ trade, analysis: ANALYSIS })
    .subRequirements.map((i) => i.text)
    .join(" | ");
}

describe("scope-shaped special requirements", () => {
  it("does not hand the roofer the electrical requirement", () => {
    // The defect, stated as the thing an operator would have seen.
    expect(scopeTextFor("Roofing")).not.toContain("electrical conduit");
  });

  it("does not hand the electrician the roofing requirement", () => {
    // Symmetry matters: a one-directional fix is a coincidence, not a rule.
    expect(scopeTextFor("Electrical")).not.toContain("Roofing debris");
  });

  it("still gives each trade its own", () => {
    expect(scopeTextFor("Roofing")).toContain("Roofing debris");
    expect(scopeTextFor("Electrical")).toContain("electrical conduit");
  });

  it("applies the same ownership test to conditions, which had none", () => {
    // A licence condition naming another trade is not this one's to satisfy.
    expect(conditionTextFor("Roofing")).not.toContain("master electrician");
    expect(conditionTextFor("Electrical")).toContain("master electrician");
  });

  it("still gives every trade the site-wide conditions", () => {
    // Most conditions are genuinely everyone's: wages, badging, hours.
    for (const trade of ["Roofing", "Electrical", "HVAC"]) {
      expect(conditionTextFor(trade), `${trade} lost the wage determination`).toContain(
        "prevailing wage"
      );
    }
  });

  it("still gives everyone the requirement that names no trade", () => {
    /*
     * The over-correction guard. Dropping the dead clause and testing only
     * "mentions my trade" would silently delete every project-wide
     * requirement from every packet, which is a bigger loss than the leak it
     * fixes and would look like a clean diff.
     */
    for (const trade of ["Roofing", "Electrical", "HVAC"]) {
      expect(scopeTextFor(trade), `${trade} lost the site-wide requirement`).toContain(
        "cleaned at the end of each shift"
      );
    }
  });

  it("keeps everything when no trade is named at all", () => {
    // A packet with no trade has no basis to exclude anything.
    const all = buildOutreachRequirements({ trade: null, analysis: ANALYSIS })
      .tradeScope.map((i) => i.text)
      .join(" | ");
    expect(all).toContain("electrical conduit");
    expect(all).toContain("Roofing debris");
    expect(all).toContain("cleaned at the end of each shift");
  });

  it("keeps everything when the analysis lists only one trade", () => {
    /*
     * With no other trades to compare against, nothing can belong to one, so
     * exclusion has no basis and the packet keeps the lot. This is the case
     * that would regress to an empty scope if the comparison were inverted.
     */
    const single = buildOutreachRequirements({
      trade: "Roofing",
      analysis: { ...ANALYSIS, trade_scopes: [ANALYSIS.trade_scopes[0]] },
    })
      .tradeScope.map((i) => i.text)
      .join(" | ");
    expect(single).toContain("Roofing debris");
    expect(single).toContain("cleaned at the end of each shift");
    expect(single).toContain("electrical conduit");
  });
});
