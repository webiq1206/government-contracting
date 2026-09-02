/**
 * One number, everywhere.
 *
 * The audit found Today saying 56, Guide Me saying 46, and other sections
 * producing different totals again -- for one account, on one screen. Nobody
 * can plan a morning around a figure that changes depending on which part of
 * the page they read, and once one count is visibly wrong, none of them are
 * trusted again.
 *
 * These tests pin the inclusion rules themselves, which is the thing that was
 * actually missing: not arithmetic, but a written-down answer to "what
 * counts".
 */
import { describe, it, expect } from "vitest";
import {
  buildWorkLedger,
  ledgerHeadline,
  ledgerBreakdown,
  type LedgerInput,
} from "@/lib/domain/work-ledger";
import { summarizeActions } from "@/lib/domain/page-guide";

const empty: LedgerInput = {
  urgent: 0,
  replyReviews: 0,
  triage: 0,
  calls: 0,
  bidWork: 0,
  quoteReviews: 0,
  subFollowUps: 0,
  compliance: 0,
  awardCompliance: 0,
  flagged: 0,
  approvals: 0,
};

describe("buildWorkLedger", () => {
  it("adds up every bucket exactly once", () => {
    const l = buildWorkLedger({ ...empty, urgent: 2, calls: 3, triage: 5 });
    expect(l.total).toBe(10);
    expect(l.buckets).toHaveLength(3);
  });

  it("leaves out buckets that are empty, so the breakdown reads cleanly", () => {
    const l = buildWorkLedger({ ...empty, calls: 1 });
    expect(l.buckets.map((b) => b.key)).toEqual(["calls"]);
  });

  it("points the primary action at the most pressing bucket", () => {
    // A deadline that passes cannot be recovered, so it outranks a call.
    const l = buildWorkLedger({ ...empty, calls: 9, urgent: 1 });
    expect(l.firstHref).toBe("/today#urgent");
    expect(l.firstLabel).toBe("Handle urgent deadlines");

    // With no deadline pressure, an unread reply is next: a subcontractor who
    // answered is warm now and cools by the hour.
    const l2 = buildWorkLedger({ ...empty, calls: 9, replyReviews: 1 });
    expect(l2.firstHref).toBe("/today#reply-reviews");
  });

  it("says nothing needs you when nothing does", () => {
    const l = buildWorkLedger(empty);
    expect(l.total).toBe(0);
    expect(l.firstHref).toBeNull();
    expect(ledgerHeadline(l)).toBe("Nothing needs you");
    expect(ledgerBreakdown(l)).toBe("");
  });

  it("calls them actions, not decisions", () => {
    // The queue holds calls, deadlines, approvals and compliance work. Calling
    // the whole thing "56 decisions" described one of its buckets.
    expect(ledgerHeadline(buildWorkLedger({ ...empty, calls: 56 }))).toBe(
      "56 actions need you"
    );
    expect(ledgerHeadline(buildWorkLedger({ ...empty, calls: 1 }))).toBe(
      "1 action needs you"
    );
  });

  it("names the biggest few and counts the rest", () => {
    const l = buildWorkLedger({
      ...empty,
      urgent: 1,
      replyReviews: 2,
      bidWork: 3,
      calls: 4,
      triage: 5,
      approvals: 6,
    });
    const text = ledgerBreakdown(l, 3);
    expect(text).toBe("1 urgent deadline, 2 replies to read, 3 bids to work, 3 more");
  });

  it("ignores negative or fractional inputs rather than propagating them", () => {
    const l = buildWorkLedger({ ...empty, calls: -4, triage: 2.7 });
    expect(l.total).toBe(2);
  });

  it("does not count work that is merely in flight", () => {
    // "Submitted, awaiting the agency's decision" needs nobody. Today used to
    // add it in, so a genuinely clear morning still read as several jobs
    // outstanding. There is deliberately no bucket for it.
    expect(Object.keys(empty)).not.toContain("awaitingOutcome");
  });
});

describe("Today and Guide Me agree", () => {
  /**
   * The regression that mattered: two surfaces, one account, two numbers.
   * summarizeActions now derives its total from the same ledger Today uses,
   * so the only way for them to disagree is for one of them to be given
   * different facts -- which is a data question, not a counting one.
   */
  it("produces the same total from the same facts", () => {
    const facts = {
      urgent: [1, 2],
      triage: [1, 2, 3],
      calls: { count: 4 },
      bidWork: [1],
      subFollowUps: [1, 2],
      quoteReviews: [1],
      complianceAlerts: [1],
      awardCompliance: [1, 2],
      proposedWeights: [1],
      backlinkApprovals: 1,
    };
    const guide = summarizeActions(facts);

    const today = buildWorkLedger({
      ...empty,
      urgent: facts.urgent.length,
      triage: facts.triage.length,
      calls: facts.calls.count,
      bidWork: facts.bidWork.length,
      subFollowUps: facts.subFollowUps.length,
      quoteReviews: facts.quoteReviews.length,
      compliance: facts.complianceAlerts.length,
      awardCompliance: facts.awardCompliance.length,
      approvals: facts.proposedWeights.length + facts.backlinkApprovals,
    });

    expect(guide.totalActions).toBe(today.total);
  });

  it("uses the work-queue total when the caller already has one", () => {
    const facts = {
      urgent: [1, 2],
      triage: [1, 2, 3],
      calls: { count: 4 },
      bidWork: [1],
      subFollowUps: [1, 2],
      quoteReviews: [1],
      complianceAlerts: [1],
      awardCompliance: [1, 2],
      proposedWeights: [1],
      backlinkApprovals: 1,
      needsYouTotal: 7,
    };
    expect(summarizeActions(facts).totalActions).toBe(7);
  });

  it("counts the work, not the size of the preview list", () => {
    /*
     * The action-center queries cap at ten rows because they also feed a
     * preview strip. Counting the rows that came back reported the cap: an
     * account with thirty borderline opportunities was told it had ten.
     */
    const capped = Array.from({ length: 10 }, (_, i) => i);
    const summary = summarizeActions({
      urgent: [],
      triage: capped,
      calls: { count: 0 },
      bidWork: [],
      subFollowUps: [],
      quoteReviews: [],
      complianceAlerts: [],
      proposedWeights: [],
      backlinkApprovals: 0,
      totals: {
        triage: 30,
        bidWork: 0,
        urgent: 0,
        flagged: 0,
        subFollowUps: 0,
        quoteReviews: 0,
        replyReviews: 0,
      },
    });
    expect(summary.totalActions).toBe(30);
  });
});
