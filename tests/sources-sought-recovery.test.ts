import { expect, it } from "vitest";
import { replayDecision } from "../lib/domain/incident";
it("does not restart bid work for a preserved Sources Sought record", () => {
  const failure = { id: "old", agent: "scoring-engine", opportunityId: "research", failedAt: new Date(), error: "credit balance is too low" };
  expect(replayDecision(failure, "provider_credit", { sourcesSought: true })).toMatchObject({ eligible: false, reason: "market_research" });
});
