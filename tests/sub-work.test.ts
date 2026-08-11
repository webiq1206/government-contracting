import { describe, it, expect } from "vitest";
import { resolveSubWork, subWorkTalkingPoint } from "@/lib/domain/sub-work";

describe("resolveSubWork", () => {
  it("prefers a matching trade_scopes entry", () => {
    const result = resolveSubWork({
      trade: "Electrical",
      analysis: {
        trade_scopes: [
          {
            trade: "Electrical",
            work: "Install and maintain outdoor lighting at the base housing area.",
          },
          { trade: "Plumbing", work: "Repair restroom fixtures in Building 3." },
        ],
        scope_plain_language: "Whole-job scope that should not win.",
      },
    });
    expect(result.source).toBe("trade_scope");
    expect(result.tradeSpecific).toBe(true);
    expect(result.work).toMatch(/outdoor lighting/i);
  });

  it("falls back to draft_sow then scope when trade-specific is missing", () => {
    const draft = resolveSubWork({
      trade: "HVAC",
      analysis: {
        draft_sow: "Replace rooftop units on Building A.",
        scope_plain_language: "Longer scope.",
      },
    });
    expect(draft.source).toBe("draft_sow");

    const scope = resolveSubWork({
      trade: "HVAC",
      analysis: { scope_plain_language: "Clear snow from parking lots nightly." },
    });
    expect(scope.source).toBe("scope");
    expect(scope.tradeSpecific).toBe(false);
  });

  it("respects maxChars with a clean break", () => {
    const result = resolveSubWork({
      analysis: {
        draft_sow:
          "First sentence about the job. Second sentence continues with more detail about frequency and materials for the winter season.",
      },
      maxChars: 40,
    });
    expect(result.work.endsWith("…")).toBe(true);
    expect(result.work.length).toBeLessThanOrEqual(45);
  });

  it("builds a talking point for calls", () => {
    const work = resolveSubWork({
      trade: "Pest Control",
      analysis: {
        trade_scopes: [
          {
            trade: "Pest Control",
            work: "Monthly bait stations and wasp nest removal around barracks.",
          },
        ],
      },
    });
    expect(subWorkTalkingPoint(work)).toMatch(/Pest Control work/i);
  });
});
