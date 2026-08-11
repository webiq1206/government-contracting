import { describe, it, expect } from "vitest";
import { buildAskUserPrompt, finalizeAskAnswer } from "@/lib/domain/guide-ask";
import { withGuideQuery } from "@/lib/guide-links";
import type { PageGuide } from "@/lib/domain/page-guide";

const guide: PageGuide = {
  pageKey: "opportunity",
  pathname: "/opportunity/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  experience: "familiar",
  headline: "1 action remains",
  situation: "You are reviewing a job.",
  completed: ["Scored"],
  needsAttention: ["Call subcontractors"],
  brostHandling: [],
  whatHappensNext: "Quotes re-price the bid.",
  steps: [
    {
      id: "1",
      title: "Call subcontractors",
      why: "Cards are ready.",
      cta: "Start",
      tone: "action",
      owner: "you",
      kind: "open-call",
      source: "journey",
    },
  ],
  idle: false,
  pageExplain: null,
  terms: [{ key: "score", label: "Score", tip: "Fit 0-100." }],
  scoreExplain: null,
  badgeCount: 1,
  automationPaused: false,
};

describe("guide ask", () => {
  it("grounds the prompt in guide facts", () => {
    const p = buildAskUserPrompt({ guide, question: "What should I do?" });
    expect(p).toContain("Call subcontractors");
    expect(p).toContain("What should I do?");
    expect(p).not.toContain("\u2014");
  });

  it("sanitizes answers", () => {
    expect(finalizeAskAnswer("Do this\u2014now")).toBe("Do this, now");
  });
});

describe("withGuideQuery", () => {
  it("preserves hash and merges params", () => {
    expect(withGuideQuery("/opportunity/x#quotes", { step: "today-quotes", focus: "quotes" })).toBe(
      "/opportunity/x?guide=1&guideStep=today-quotes&guideFocus=quotes#quotes"
    );
    expect(withGuideQuery("/call-queue?open=abc", { step: "today-calls" })).toBe(
      "/call-queue?open=abc&guide=1&guideStep=today-calls"
    );
  });
});
