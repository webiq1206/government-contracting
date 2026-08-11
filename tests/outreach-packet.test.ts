import { describe, it, expect } from "vitest";
import { buildOutreachPacket } from "../lib/domain/outreach-packet";
import { scoreDocForTrade } from "../lib/opportunity-attachments";

describe("buildOutreachPacket", () => {
  it("refuses thin placeholder scope", () => {
    const packet = buildOutreachPacket({
      trade: "HVAC",
      analysis: {
        scope_plain_language: "Not specified in the provided documents",
        trade_scopes: [],
      },
    });
    expect(packet.tooThin).toBe(true);
  });

  it("builds a trade-specific packet with deadline and location", () => {
    const packet = buildOutreachPacket({
      trade: "Water Treatment",
      locationState: "MA",
      locationText: "Ayer, MA",
      deadlineLabel: "Aug 19, 2026, 8:00 AM",
      analysis: {
        trade_scopes: [
          {
            trade: "Water Treatment",
            work: "Supply and dose water treatment chemicals weekly, sample loops, and report readings.",
          },
        ],
        location: "FMC Devens, Ayer, MA",
        special_requirements: ["Maintain SDS on site", "Ignore this very long legal boilerplate ".repeat(20)],
      },
    });
    expect(packet.tooThin).toBe(false);
    expect(packet.tradeSpecific).toBe(true);
    expect(packet.scopeSummary).toMatch(/Water Treatment|chemicals|Aug 19/i);
    expect(packet.scopeSummary).toMatch(/payment terms/i);
  });
});

describe("scoreDocForTrade", () => {
  it("prefers trade-named and scope docs", () => {
    expect(scoreDocForTrade("Electrical Specs.pdf", "Electrical")).toBeGreaterThan(
      scoreDocForTrade("Cover Letter.pdf", "Electrical")
    );
    expect(scoreDocForTrade("PWS Statement of Work.pdf", "Plumbing")).toBeGreaterThan(0);
  });
});
