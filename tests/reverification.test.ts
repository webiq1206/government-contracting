import { describe, expect, it } from "vitest";
import {
  blockedWhileVerifying,
  claimsVerified,
  coverageRatio,
  downstreamImpact,
  mustBeReviewed,
  outcomeState,
  outcomeSummary,
  parseVerificationState,
  partitionFindings,
  recommendScope,
  verificationKey,
  type Finding,
} from "../lib/domain/reverification";

/**
 * What a re-check is allowed to conclude.
 *
 * The easy version of this feature re-runs the analyst, overwrites the record
 * and marks it verified. That is repetition, not verification: a model asked
 * the same question twice tends to give the same answer twice, including when
 * the answer was wrong, and the second run produces no new information while
 * looking exactly like confirmation.
 *
 * So almost everything below is a refusal to claim more than was established.
 */

const NOW = new Date("2026-03-10T12:00:00Z");

function coverage(patch: Partial<Parameters<typeof coverageRatio>[0]> = {}) {
  return {
    documentsExpected: 9,
    documentsVerified: 9,
    documentsUnreadable: 0,
    pagesProcessed: 240,
    ...patch,
  };
}

describe("what a completed run may claim", () => {
  it("says nothing changed only when everything was read and nothing changed", () => {
    expect(
      outcomeState({ findings: [], coverage: coverage(), aborted: false, failedScopes: [] })
    ).toBe("verified_no_changes");
  });

  it("refuses a clean verdict when a document could not be opened", () => {
    const state = outcomeState({
      findings: [],
      coverage: coverage({ documentsVerified: 5, documentsUnreadable: 4 }),
      aborted: false,
      failedScopes: [],
    });
    // The statement this module exists to prevent: "Verified" with four
    // documents unread, which is the version that stops anybody looking again.
    expect(state).toBe("partially_verified");
    expect(claimsVerified(state)).toBe(false);
  });

  it("says how much was actually read rather than just 'partly'", () => {
    const summary = outcomeSummary(
      "partially_verified",
      coverage({ documentsVerified: 5, documentsUnreadable: 4 })
    );
    expect(summary).toContain("56%");
    expect(summary).toContain("unproven");
  });

  it("lets a conflict beat a mere change", () => {
    const findings: Finding[] = [
      { scope: "documents", subject: "Attachment 3", kind: "changed", impact: "material", before: "a", after: "b" },
      {
        scope: "requirements_and_deadlines",
        subject: "Bid bond",
        kind: "conflict",
        impact: "blocking",
        before: "Not required",
        after: "Required at 20%",
      },
    ];
    expect(outcomeState({ findings, coverage: coverage(), aborted: false, failedScopes: [] })).toBe(
      "conflicts_found"
    );
  });

  it("lets a partial run beat a conflict-free change", () => {
    const findings: Finding[] = [
      { scope: "documents", subject: "Attachment 3", kind: "changed", impact: "material", before: "a", after: "b" },
    ];
    expect(
      outcomeState({
        findings,
        coverage: coverage({ documentsVerified: 8 }),
        aborted: false,
        failedScopes: [],
      })
    ).toBe("partially_verified");
  });

  it("reports a run that stopped as failed, not as clean", () => {
    expect(
      outcomeState({ findings: [], coverage: coverage(), aborted: true, failedScopes: [] })
    ).toBe("failed");
    expect(outcomeSummary("failed", coverage())).toContain("is not verified");
  });

  it("reads an unrecognised state as never checked", () => {
    expect(parseVerificationState("looks_fine")).toBe("not_verified");
    expect(parseVerificationState(null)).toBe("not_verified");
    expect(parseVerificationState("verified_no_changes")).toBe("verified_no_changes");
  });
});

describe("which check to offer", () => {
  const base = {
    now: NOW,
    lastFullAt: new Date("2026-03-09T12:00:00Z"),
    freshnessHours: 72,
    amendmentDetected: false,
    documentsChanged: false,
    conflictOpen: false,
    approachingSubmission: false,
  };

  it("goes straight to a full check when an amendment landed", () => {
    const r = recommendScope({ ...base, amendmentDetected: true });
    expect(r.scope).toBe("full");
    expect(r.urgent).toBe(true);
  });

  it("goes full when a document changed, because everything read from it is in question", () => {
    expect(recommendScope({ ...base, documentsChanged: true }).scope).toBe("full");
  });

  it("goes full when nothing has ever been checked", () => {
    const r = recommendScope({ ...base, lastFullAt: null });
    expect(r.scope).toBe("full");
    expect(r.because).toContain("never been checked");
  });

  it("goes full once the last check is past the freshness window", () => {
    const r = recommendScope({
      ...base,
      lastFullAt: new Date("2026-03-01T12:00:00Z"),
    });
    expect(r.scope).toBe("full");
    expect(r.because).toContain("9 days ago");
  });

  it("offers the narrow check only when everything else is settled", () => {
    expect(recommendScope(base).scope).toBe("source_and_amendments");
  });

  it("checks the package when a recently verified bid is about to go out", () => {
    expect(recommendScope({ ...base, approachingSubmission: true }).scope).toBe("bid_readiness");
  });
});

describe("what may be applied without a person", () => {
  const finding = (patch: Partial<Finding>): Finding => ({
    scope: "source_and_amendments",
    subject: "Agency name",
    kind: "changed",
    impact: "safe_metadata",
    before: "Dept of X",
    after: "Department of X",
    ...patch,
  });

  it("applies a harmless metadata correction", () => {
    const { automatic, needsReview } = partitionFindings([finding({})]);
    expect(automatic).toHaveLength(1);
    expect(needsReview).toHaveLength(0);
  });

  it("never applies a date, however it is labelled", () => {
    // "It is only a small change" is exactly the reasoning that applies a new
    // deadline silently, so the field list decides rather than the impact tag.
    const { automatic, needsReview } = partitionFindings([
      finding({ subject: "Offer deadline", impact: "safe_metadata" }),
    ]);
    expect(automatic).toHaveLength(0);
    expect(needsReview).toHaveLength(1);
  });

  it("never applies anything touching eligibility, scope, price or submission", () => {
    for (const field of [
      "Set aside",
      "NAICS code",
      "Required trade",
      "Pricing schedule",
      "Submission method",
      "Bid bond",
      "Wage determination",
      "Timezone",
    ]) {
      expect(mustBeReviewed(field)).toBe(true);
    }
    expect(mustBeReviewed("Agency name")).toBe(false);
  });

  it("never applies an addition or a removal automatically", () => {
    const { automatic } = partitionFindings([
      finding({ kind: "added", subject: "Contact phone" }),
      finding({ kind: "removed", subject: "Contact phone" }),
    ]);
    expect(automatic).toHaveLength(0);
  });

  it("leaves the unchanged out of both lists", () => {
    const { automatic, needsReview } = partitionFindings([finding({ kind: "unchanged" })]);
    expect(automatic).toHaveLength(0);
    expect(needsReview).toHaveLength(0);
  });
});

describe("what the findings cost downstream", () => {
  it("stops outreach when the trade scope moved", () => {
    const impact = downstreamImpact([
      {
        scope: "trade_scopes",
        subject: "Required trades",
        kind: "changed",
        impact: "material",
        before: "Electrical, Plumbing",
        after: "Electrical, Plumbing, Fire suppression",
      },
    ]);
    expect(impact.stopOutreach).toBe(true);
    // The subcontractors were asked to price work the solicitation no longer
    // describes, and a follow-up chasing that price makes it worse.
    expect(impact.lines.join(" ")).toContain("new packet");
  });

  it("marks quotes for reconfirmation rather than deleting them", () => {
    const impact = downstreamImpact([
      {
        scope: "requirements_and_deadlines",
        subject: "Bid bond",
        kind: "added",
        impact: "material",
        before: null,
        after: "Required at 20%",
      },
    ]);
    expect(impact.reconfirmQuotes).toBe(true);
    expect(impact.lines.join(" ")).toContain("kept, not deleted");
  });

  it("elevates a deadline that moved earlier", () => {
    const impact = downstreamImpact([
      {
        scope: "requirements_and_deadlines",
        subject: "Offer deadline",
        kind: "changed",
        impact: "blocking",
        before: "2026-04-01",
        after: "2026-03-20",
      },
    ]);
    expect(impact.deadlineEarlier).toBe(true);
    expect(impact.lines[0]).toContain("already late");
  });

  it("says plainly when nothing downstream moves", () => {
    const impact = downstreamImpact([
      {
        scope: "source_and_amendments",
        subject: "Agency name",
        kind: "changed",
        impact: "safe_metadata",
        before: "Dept of X",
        after: "Department of X",
      },
    ]);
    expect(impact.stopOutreach).toBe(false);
    expect(impact.lines.join(" ")).toContain("Nothing downstream is affected");
  });
});

describe("what is held while a check runs", () => {
  it("holds everything during a full check", () => {
    expect(blockedWhileVerifying("full")).toEqual({
      outreach: true,
      calls: true,
      submission: true,
    });
  });

  it("holds nothing for a look at the amendment list", () => {
    // A product that freezes everything during every check teaches people to
    // stop running checks.
    expect(blockedWhileVerifying("source_and_amendments")).toEqual({
      outreach: false,
      calls: false,
      submission: false,
    });
  });

  it("holds only the submission while the package is rechecked", () => {
    expect(blockedWhileVerifying("bid_readiness")).toEqual({
      outreach: false,
      calls: false,
      submission: true,
    });
  });

  it("holds everything for a scope it does not recognise", () => {
    // Not knowing what a check touches is not a reason to let a bid go out
    // during it.
    expect(blockedWhileVerifying("something_new" as never)).toEqual({
      outreach: true,
      calls: true,
      submission: true,
    });
  });
});

describe("running one check at a time", () => {
  it("keys on the work rather than on the request", () => {
    // A double click, a retry and a scheduled run all collapse into one.
    expect(verificationKey("opp-1", "full")).toBe(verificationKey("opp-1", "full"));
    expect(verificationKey("opp-1", "full")).not.toBe(verificationKey("opp-1", "documents"));
    expect(verificationKey("opp-1", "full")).not.toBe(verificationKey("opp-2", "full"));
  });
});
