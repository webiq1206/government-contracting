import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { queuedAfterScore } from "@/lib/domain/score-downstream";

describe("work queued after scoring", () => {
  it("starts the full pipeline on pursue", () => {
    const jobs = queuedAfterScore("pursue", "opp-1");
    expect(jobs.map((j) => j.agent)).toEqual(["solicitation-analyst", "pricing-research"]);
    expect(jobs.some((j) => j.payload.briefOnly)).toBe(false);
  });

  it("starts the analyst only on review, so Overview gets a brief", () => {
    const jobs = queuedAfterScore("review", "opp-2");
    expect(jobs.map((j) => j.agent)).toEqual(["solicitation-analyst"]);
    expect(jobs[0].payload.briefOnly).toBe(true);
    expect(jobs[0].opts?.singletonKey).toBe("analyze:opp-2");
  });

  it("queues nothing on dismiss", () => {
    expect(queuedAfterScore("dismiss", "opp-3")).toEqual([]);
  });

  it("is the function scoring actually calls", () => {
    const src = readFileSync("lib/agents/scoring-engine.ts", "utf8");
    expect(src).toContain("queuedAfterScore(\"pursue\"");
    expect(src).toContain("queuedAfterScore(\"review\"");
  });
});

describe("overview never ships the empty-summary card", () => {
  it("always renders a Bid Brief from the stored analysis or the notice fallback", () => {
    const src = readFileSync("app/(dash)/opportunity/[id]/page.tsx", "utf8");
    expect(src).toContain("noticeBriefFromOpportunity");
    expect(src).not.toContain("has not run yet");
    expect(src).not.toContain("Plain-English summary");
  });
});
