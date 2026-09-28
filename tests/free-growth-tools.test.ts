import { describe, expect, it } from "vitest";
import { BID_CHECKS, bidReadiness, capabilityText, csvCell, matrixCsv, type BidAnswers } from "@/lib/marketing/free-tools";
import { attributionFromSearch, campaignAttribution, campaignUrl } from "@/lib/marketing/campaigns";
import { resourceFeed } from "@/lib/marketing/feed";
import { publicEventPayload } from "@/lib/domain/public-analytics";

describe("bid readiness never hides an unknown or critical blocker", () => {
  it("does not score unanswered checks as confirmed", () => { expect(bidReadiness({})).toMatchObject({ confirmed: 0, unanswered: 7, percent: 0, status: "Complete your review" }); });
  it("a deadline blocker overrides six positive answers", () => {
    const answers = Object.fromEntries(BID_CHECKS.map(c => [c.id, "yes"])) as BidAnswers;
    answers.deadline = "no";
    expect(bidReadiness(answers)).toMatchObject({ confirmed: 6, status: "Resolve a critical blocker" });
  });
  it("an unknown critical check cannot become ready", () => {
    const answers = Object.fromEntries(BID_CHECKS.map(c => [c.id, "yes"])) as BidAnswers;
    answers.eligibility = "unknown";
    expect(bidReadiness(answers).status).toBe("Clarify before committing");
  });
});
describe("exports", () => {
  it("neutralizes spreadsheet formula execution and preserves embedded quotes", () => {
    for (const text of ['=HYPERLINK("bad")', '+123', '-2+3', '@SUM(A1)', '  =1', '\t=1']) expect(csvCell(text)).toMatch(/^"'/);
    expect(csvCell('Site "A"\ncheck')).toBe('"Site ""A""\ncheck"');
  });
  it("exports actual rows without fabricated requirement values", () => {
    const csv = matrixCsv([{ requirement: "A,B", source: "p. 8", owner: "", response: "", status: "Not reviewed" }]);
    expect(csv).toContain('"A,B","p. 8","","","Not reviewed"');
  });
  it("does not invent absent company qualifications", () => {
    const text = capabilityText({ company: "Example", summary: "Cleaning", competencies: "Floor care", differentiators: "", experience: "", identifiers: "", contact: "Business contact" });
    expect(text).not.toContain("## Relevant experience"); expect(text).not.toContain("## Verified business details");
  });
});
describe("privacy-preserving acquisition", () => {
  it("drops unknown sources, personal query values and extra fields", () => {
    expect(attributionFromSearch('?utm_source=person@example.com&utm_campaign=free-tools&utm_content=bid-scorecard&email=private')).toEqual({ campaign: "free-tools", content: "bid-scorecard" });
    expect(campaignAttribution({ source: "linkedin", referrer: "private" })).toEqual({ source: "linkedin" });
  });
  it("only adds known campaign metadata to the public endpoint", () => {
    expect(publicEventPayload({ event: "resource_download", path: "/tools/bid-no-bid", attribution: { source: "reddit", campaign: "free-tools", content: "bad@example.com" }, form: "private" })?.meta).toEqual({ source: "reddit", campaign: "free-tools" });
  });
  it("keeps campaign URLs on the owned site", () => {
    expect(() => campaignUrl('https://example.com', 'reddit', 'free-tools', 'bid-scorecard')).toThrow();
    expect(campaignUrl('/tools/bid-no-bid', 'reddit', 'free-tools', 'bid-scorecard')).toContain('utm_source=reddit');
  });
  it("publishes stable feed IDs and escapes URL metadata", () => {
    const feed = resourceFeed('https://brostco.com');
    expect(feed).toContain('<guid isPermaLink="true">https://brostco.com/tools/bid-no-bid</guid>');
    expect(feed).not.toContain("<pubDate>");
  });
});
