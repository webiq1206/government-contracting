import {
  type RecapFacts,
  type RecapTotals,
} from "@/lib/domain/recap/types";

/**
 * An empty day, as facts.
 *
 * Tests build the day they mean by overriding one or two fields, which keeps
 * each test about the rule it is checking rather than about assembling
 * seventeen empty arrays.
 */
export function emptyTotals(over: Partial<RecapTotals> = {}): RecapTotals {
  return {
    opportunitiesDiscovered: 0,
    decisionsMade: 0,
    outreachSent: 0,
    outreachDelivered: 0,
    outreachFailed: 0,
    repliesReceived: 0,
    repliesNeedingReview: 0,
    draftsGenerated: 0,
    callsLogged: 0,
    quotesRecorded: 0,
    bidsSubmitted: 0,
    notesAdded: 0,
    subsAdded: 0,
    complianceResolved: 0,
    agentRuns: 0,
    agentRunErrors: 0,
    ...over,
  };
}

export function emptyFacts(over: Partial<RecapFacts> = {}): RecapFacts {
  return {
    orgId: "11111111-1111-4111-8111-111111111111",
    orgName: "Test Contracting",
    totals: emptyTotals(over.totals),
    deadlines: [],
    replies: [],
    unansweredReplies: [],
    failedSends: [],
    compliance: [],
    reviewQueue: [],
    callQueue: [],
    draftsWaiting: [],
    problems: [],
    discovered: [],
    decided: [],
    submitted: [],
    outcomes: [],
    outreachSent: [],
    completed: [],
    ...over,
    // Applied after the spread so a caller passing partial totals still gets
    // every field filled.
    ...(over.totals ? { totals: emptyTotals(over.totals) } : {}),
  };
}
