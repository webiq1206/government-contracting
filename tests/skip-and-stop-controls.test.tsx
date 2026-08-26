import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * What the two controls have to say before they do anything.
 *
 * The skip used to be one click. It recorded a reason nobody chose and a scope
 * nobody was asked about, so the decision lasted until the next Call Prep run
 * rebuilt the card, and downstream it was indistinguishable from a decline.
 *
 * The stop used to not exist. The dangerous version of it is a confirmation
 * that says "are you sure", because the same button can mean "cancel one
 * follow-up" or "leave two trades with nobody quoting them" and the label
 * cannot tell them apart.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const { SkipCallControl } = await import("../components/skip-call-control");
const { StopOutreach } = await import("../components/stop-outreach");

describe("the skip control", () => {
  it("does not act on the first click", () => {
    const html = renderToStaticMarkup(
      <SkipCallControl callCardId="c1" companyName="Alpha Electric" trade="Electrical" />
    );
    // A button, not a completed action: the reason and the scope both still
    // have to be asked.
    expect(html).toContain("Skip this call");
    expect(html).not.toContain("How far does this go");
  });
});

describe("the stop-outreach control", () => {
  it("opens as a button rather than as an armed confirmation", () => {
    const html = renderToStaticMarkup(
      <StopOutreach
        subcontractorId="s1"
        companyName="Alpha Electric"
        opportunityId="opp-1"
        trade="Electrical"
      />
    );
    expect(html).toContain("Stop outreach for this subcontractor");
    expect(html).not.toContain("Show what this cancels");
  });
});
