import { expect, it } from "vitest";
import { replayDecision } from "../lib/domain/incident";
it("never replays an unresolved paid completion for a matching incident", () => {
  const failure = { id: "held", agent: "solicitation-analyst", opportunityId: "bid", failedAt: new Date(), error: "AI work has an unresolved completion. Reconcile its saved output before retrying; no paid replay is allowed." };
  expect(replayDecision(failure, "completion_reconciliation")).toMatchObject({ eligible: false, reason: "unsafe_to_replay" });
});
it("does not restart bid work for a preserved Sources Sought record", () => {
  const failure = { id: "old", agent: "scoring-engine", opportunityId: "research", failedAt: new Date(), error: "credit balance is too low" };
  expect(replayDecision(failure, "provider_credit", { sourcesSought: true })).toMatchObject({ eligible: false, reason: "market_research" });
});
