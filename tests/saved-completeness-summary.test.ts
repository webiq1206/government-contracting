import { describe, expect, it } from "vitest";
import { computeBidReadiness } from "@/lib/domain/bid-readiness";
import { buildGuidedPlan } from "@/lib/domain/guided-plan";
import type { SavedSolicitationEvidence } from "@/lib/domain/saved-solicitation-completeness";

const completeEvidence: SavedSolicitationEvidence = {
  analysisInputHash: "synthetic-current-source-hash",
  completeness: { ok: true, missing: [] },
  verificationIssues: [],
  riskFlags: [],
};

function summaries(sourceEvidence: SavedSolicitationEvidence = completeEvidence,
  extra: { stage?: string; status?: string; outcome?: string; bidSubmitted?: boolean } = {}) {
  const readiness = computeBidReadiness({
    stage: "call_queue", status: "open", deadline: null, riskFlags: [...(sourceEvidence.riskFlags ?? [])],
    requiredTrades: ["Fuel systems operations and maintenance", "Environmental/hazmat compliance"],
    quotes: [], tradeCoverageUncovered: 2, subsFound: 0, hasBid: false,
    sourceEvidence, ...extra,
  });
  const plan = buildGuidedPlan({
    stage: "call_queue", status: "open", tier: "pursue", humanActionRequired: true,
    pastPerfBlocked: false, expired: false, score: 67, hasAnalysis: true, missingInfo: [],
    coverage: { trades: [] }, quotesEntered: 0, outreachDraftOnly: false, callsEnabled: false,
    pendingCalls: 0, hasBid: false, bidAmount: null, packageReady: null, packageBlockers: [],
    needsSignature: 0, needsProvide: 0, bidSubmitted: false, outcome: null,
    sourceEvidence, ...extra,
  });
  return { readiness, plan, missing: plan.steps.find(step => step.key === "missing")! };
}

describe("saved source evidence in completeness summaries", () => {
  it.each<[string, Partial<SavedSolicitationEvidence>]>([
    ["GOCO legacy analysis without hash or snapshot", { analysisInputHash: null, completeness: undefined, riskFlags: ["incomplete_documentation", "attachments_inaccessible"] }],
    ["amended source invalidated the hash", { analysisInputHash: null }],
    ["blank source hash", { analysisInputHash: "  " }],
    ["missing snapshot", { completeness: undefined }],
    ["failed snapshot without listed items", { completeness: { ok: false, missing: [] } }],
    ["source verification issue despite ok flag", { verificationIssues: ["Current PWS was not read"] }],
    ["missing item despite ok flag", { completeness: { ok: true, missing: [{ key: "pws", what: "PWS", why: "Not read", retrievable: "admin", resolution: "Review source", critical: true }] } }],
    ["remaining document warning", { riskFlags: ["documents_partly_read"] }],
    ["legacy attachment warning", { riskFlags: ["attachments_inaccessible"] }],
  ])("does not credit %s as complete", (_name, override) => {
    const { readiness, missing } = summaries({ ...completeEvidence, ...override });
    expect(readiness.complete.some(item => item.key === "solicitation_complete")).toBe(false);
    expect(readiness.percent).toBe(0);
    expect(readiness.actionRequired.some(item => item.key === "solicitation_review" || item.key.startsWith("missing-"))).toBe(true);
    expect(missing.status).toBe("blocked");
    expect(missing.detail).not.toMatch(/Nothing critical is missing|check passed/i);
    expect(missing.blockers?.length).toBeGreaterThan(0);
  });

  it("credits a successful current snapshot without source warnings", () => {
    const { readiness, missing } = summaries();
    expect(readiness.complete.some(item => item.key === "solicitation_complete")).toBe(true);
    expect(readiness.percent).toBe(25);
    expect(missing.status).toBe("done");
    expect(missing.detail).toBe("Saved completeness check passed");
  });

  it("does not turn a valid non-source business warning into a source gap", () => {
    const { readiness, missing } = summaries({ ...completeEvidence, riskFlags: ["possible_high_value_contract"] });
    expect(readiness.complete.some(item => item.key === "solicitation_complete")).toBe(true);
    expect(missing.status).toBe("done");
  });

  it("does not infer source completeness from a won lifecycle or offer closed-record actions", () => {
    const { missing, plan } = summaries({ ...completeEvidence, analysisInputHash: null },
      { stage: "won", status: "closed", outcome: "won", bidSubmitted: true });
    expect(missing.status).not.toBe("done");
    expect(missing.detail).not.toMatch(/Nothing critical is missing|check passed/i);
    expect(plan.steps.some(step => step.action)).toBe(false);
  });
});
