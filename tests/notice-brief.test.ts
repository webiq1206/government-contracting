import { describe, expect, it } from "vitest";
import {
  buildNoticeBrief,
  isNoticeOnlyBrief,
  noticeBriefFromOpportunity,
  noticePlainText,
} from "@/lib/domain/notice-brief";
import type { Opportunity, ScoreBreakdown } from "@/lib/types";

describe("notice brief", () => {
  it("marks the fallback so a later model read is not skipped", () => {
    const brief = buildNoticeBrief({
      title: "Install electronic locks",
      agency: "VA",
      description: "Replace locksets in Building 3. Include cores and closer hardware.",
      locationState: "FL",
      valueEstimated: 120000,
      deadline: "2026-10-01T17:00:00Z",
      scoreSummary: "This opportunity scores 53 points on a thin notice.",
    });
    expect(isNoticeOnlyBrief(brief)).toBe(true);
    expect(brief.project_overview).toContain("Replace locksets");
    expect(brief.scope_plain_language).toContain("Include cores");
    expect(brief.pursue_recommendation).toContain("53 points");
    expect(brief.estimated_value).toContain("120,000");
    expect(brief.compliance_matrix).toEqual([]);
  });

  it("does not treat a model brief as a notice stub", () => {
    expect(isNoticeOnlyBrief({ brief_source: "model" } as never)).toBe(false);
    expect(isNoticeOnlyBrief({ project_overview: "Job" } as never)).toBe(false);
    expect(isNoticeOnlyBrief(null)).toBe(false);
  });

  it("strips SAM markup so the box is readable", () => {
    expect(noticePlainText("<p>Paint the hangar.&nbsp;Seal the joints.</p>")).toBe(
      "Paint the hangar. Seal the joints."
    );
  });

  it("still produces a brief when the notice has almost nothing", () => {
    const brief = noticeBriefFromOpportunity(
      {
        title: "Sources sought: HVAC",
        agency: "USACE",
        description: null,
        location_text: null,
        location_state: null,
        value_estimated: null,
        deadline: null,
        set_aside_type: null,
        score: 62,
      } as Pick<
        Opportunity,
        | "title"
        | "agency"
        | "description"
        | "location_text"
        | "location_state"
        | "value_estimated"
        | "deadline"
        | "set_aside_type"
        | "score"
      >,
      { summary: "Needs a person to look." } as ScoreBreakdown
    );
    expect(brief.project_overview).toContain("HVAC");
    expect(brief.scope_plain_language).toMatch(/does not include a work description/);
    expect(brief.pursue_recommendation).toBe("Needs a person to look.");
  });

  it("uses the numeric score when scoring left no summary", () => {
    const brief = buildNoticeBrief({
      title: "Facility maintenance",
      score: 62,
    });
    expect(brief.pursue_recommendation).toBe("This opportunity scores 62 points.");
  });
});
