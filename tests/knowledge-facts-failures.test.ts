import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentOrg: vi.fn(),
  queueCounts: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/data", () => ({
  currentOrg: mocks.currentOrg,
  queueCounts: mocks.queueCounts,
}));

import { knowledgeFacts } from "@/lib/knowledge-facts";

describe("knowledge center fact availability", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.currentOrg.mockReset().mockResolvedValue("11111111-1111-4111-8111-111111111111");
    mocks.queueCounts.mockReset().mockResolvedValue({ review: 0, callQueue: 0, today: 0 });
  });

  it("marks a successful empty read as available", async () => {
    mocks.query.mockResolvedValueOnce([{}]);

    const facts = await knowledgeFacts();

    expect(facts.quickStartAvailable).toBe(true);
    expect(facts.quickStart).toEqual({
      hasOpportunities: false,
      hasDecided: false,
      hasSubs: false,
    });
    expect(facts.warnings).toEqual([]);
    expect(facts.evidence.found).toBeDefined();
  });

  it("does not present a failed activity read as an empty account", async () => {
    mocks.query.mockRejectedValueOnce(new Error("workflow read failed"));

    const facts = await knowledgeFacts();

    expect(facts.quickStartAvailable).toBe(false);
    expect(facts.evidence).toEqual({});
    expect(facts.warnings).toEqual([
      expect.stringContaining("quick-start progress are unknown"),
    ]);
  });

  it("keeps queue counts unknown when that independent read fails", async () => {
    mocks.query.mockResolvedValueOnce([{}]);
    mocks.queueCounts.mockRejectedValueOnce(new Error("queue read failed"));

    const facts = await knowledgeFacts();

    expect(facts.quickStartAvailable).toBe(true);
    expect(facts.evidence.decided?.waiting).toBeNull();
    expect(facts.evidence.called?.waiting).toBeNull();
    expect(facts.warnings).toEqual([
      expect.stringContaining("waiting-for-you counts are unknown"),
    ]);
  });
});
