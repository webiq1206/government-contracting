import { describe, it, expect } from "vitest";
import {
  buildCallGuide,
  buildOpener,
  leaksBidContext,
  allQuestions,
  type CallGuideInput,
} from "@/lib/domain/call-guide";

function input(over: Partial<CallGuideInput> = {}): CallGuideInput {
  return {
    companyName: "Coastal Pipeline Products Corporation",
    trade: "Manhole cover fabrication/supply (FRP)",
    opportunityTitle: "USMMA - UNDERGROUND STORAGE TANK MANHOLE COVERS",
    agency: "MARITIME ADMINISTRATION",
    locationLabel: "Kings Point, NY",
    callerName: "Todd",
    callerCompany: "Brost Co",
    source: "reply",
    ...over,
  };
}

describe("the spoken opener", () => {
  it("never contains a placeholder for the operator to substitute mid-call", () => {
    const variants: CallGuideInput[] = [
      input(),
      input({ callerName: null }),
      input({ callerCompany: null }),
      input({ callerName: null, callerCompany: null }),
      input({ source: "outreach" }),
      input({ trade: null, locationLabel: null }),
    ];
    for (const v of variants) {
      const { opener } = buildCallGuide(v);
      expect(opener, opener).not.toMatch(/\[|\]/);
      expect(opener, opener).not.toMatch(/your name|your company|undefined|null/i);
    }
  });

  it("introduces the caller by name and company when both are known", () => {
    expect(buildCallGuide(input()).opener).toMatch(/this is Todd with Brost Co\./);
  });

  it("falls back to the company alone rather than leaving a gap", () => {
    const o = buildOpener({ callerCompany: "Brost Co", trade: "HVAC", replied: true });
    expect(o).toMatch(/I'm calling from Brost Co\./);
    expect(o).not.toMatch(/this is\s+\./);
  });

  it("drops the introduction entirely when we know neither, without doubling the opening", () => {
    const o = buildOpener({ trade: "HVAC", replied: true });
    expect(o).toBe(
      "Hi. Thanks for getting back to me about the HVAC work. Do you have a couple of minutes?"
    );
  });

  it("does not assume we know who picked up", () => {
    // No contact name on file is the normal case for an emailed inbox.
    const o = buildCallGuide(input({ ownerName: null })).opener;
    expect(o.startsWith("Hi, ")).toBe(true);
    expect(o).not.toMatch(/\bHi\s+,/);
  });

  it("uses their name when we happen to have it", () => {
    expect(buildCallGuide(input({ ownerName: "Dana Reyes" })).opener).toMatch(/^Hi Dana, /);
  });

  it("keeps the trade as written rather than lower-casing an acronym", () => {
    expect(buildOpener({ trade: "HVAC", callerCompany: "Brost Co" })).toMatch(/the HVAC work/);
  });

  it("says why we are calling differently on a reply than a cold follow-up", () => {
    expect(buildCallGuide(input({ source: "reply" })).opener).toMatch(
      /Thanks for getting back to me/
    );
    expect(buildCallGuide(input({ source: "outreach" })).opener).toMatch(
      /I sent you an email recently .* and wanted to follow up/
    );
  });
});

describe("never leading with the government contract", () => {
  it("keeps award and bid language out of the whole guide", () => {
    const guide = buildCallGuide(input());
    const spoken = [
      guide.opener,
      guide.closer,
      ...allQuestions(guide).map((q) => q.ask),
    ].join(" ");
    for (const banned of [
      /if we win/i,
      /\bwe win\b/i,
      /already bid/i,
      /solicitation/i,
      /\bthe agency\b/i,
      /government/i,
    ]) {
      expect(spoken, `leaked: ${banned}`).not.toMatch(banned);
    }
  });

  it("no longer names the agency in the closing line", () => {
    expect(buildCallGuide(input()).closer).not.toMatch(/MARITIME/i);
  });

  it("asks about interest without framing it as a contest", () => {
    const asks = allQuestions(buildCallGuide(input())).map((q) => q.ask);
    expect(asks).toContain("Is this something you'd want to take on?");
    expect(asks.some((a) => /already bid/i.test(a))).toBe(false);
    expect(asks.some((a) => /^How soon could you start/.test(a))).toBe(true);
  });

  it("drops generated questions that give the framing away", () => {
    for (const leak of [
      "Would you be available if we are awarded the contract?",
      "Have you already bid this project?",
      "Does your firm hold a federal contract vehicle?",
      "Did you see the solicitation on SAM.gov?",
    ]) {
      expect(leaksBidContext(leak), leak).toBe(true);
    }
    const guide = buildCallGuide(
      input({
        generated: [
          "Would you be available if we are awarded the contract?",
          "Can you fabricate FRP covers to a custom diameter?",
        ],
      })
    );
    const asks = allQuestions(guide).map((q) => q.ask);
    expect(asks).toContain("Can you fabricate FRP covers to a custom diameter?");
    expect(asks.some((a) => /awarded the contract/i.test(a))).toBe(false);
  });

  it("keeps ordinary trade questions that merely mention winning nothing", () => {
    expect(leaksBidContext("How many crews could you put on site?")).toBe(false);
    expect(leaksBidContext("Do you fabricate in house or subcontract it?")).toBe(false);
  });
});
