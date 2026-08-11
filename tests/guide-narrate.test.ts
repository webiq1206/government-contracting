import { describe, it, expect } from "vitest";
import {
  buildNarrateUserPrompt,
  finalizeNarration,
} from "@/lib/domain/guide-narrate";
import type { PageGuide } from "@/lib/domain/page-guide";

const sample: PageGuide = {
  pageKey: "opportunity",
  pathname: "/opportunity/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  experience: "new",
  headline: "2 actions remain on this opportunity",
  situation: "You are reviewing Boise VA Renovation. Current stage: Calls to make.",
  stageLabel: "Calls to make",
  scoreLine: "Score 74",
  completed: ["Scored", "Analyzed"],
  needsAttention: ["Call the subcontractors"],
  brostHandling: [],
  whatHappensNext: "Saving a call's quote immediately re-prices the bid.",
  steps: [
    {
      id: "1",
      title: "Call the subcontractors",
      why: "Subs are ready to be called.",
      cta: "Start calling",
      tone: "action",
      owner: "you",
      kind: "open-call",
      source: "journey",
      adapter: "call",
    },
  ],
  idle: false,
  pageExplain: null,
  terms: [],
  scoreExplain: null,
  badgeCount: 1,
  opportunityId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  automationPaused: false,
};

describe("guide narrate prompt", () => {
  it("includes structured facts and forbids inventing outside them", () => {
    const prompt = buildNarrateUserPrompt(sample);
    expect(prompt).toContain("Boise VA Renovation");
    expect(prompt).toContain("Call the subcontractors");
    expect(prompt).toContain("Score 74");
    expect(prompt).not.toContain("\u2014");
  });

  it("strips em dashes from model output", () => {
    expect(finalizeNarration("Act now\u2014call the sub")).toBe("Act now, call the sub");
  });
});
