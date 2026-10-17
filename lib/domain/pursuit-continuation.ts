/**
 * Why a pursue item can sit with pairings and still never reach a quote request.
 *
 * Sub Finder, Sub Verify, and Outreach are not on the clock. Each one is
 * enqueued only by the step before it. Scoring recovery puts back unscored
 * rows and missing briefs. It does not look at a pursue row that already has
 * a score. A refused or expired enqueue is therefore permanent: the pairing
 * stays unverified, and Outreach never starts because only a verification
 * that just succeeded queues it.
 *
 * These predicates are the gate the recovery sweep uses. They do not send mail.
 */

export interface SourceCandidate {
  tier: string | null;
  status: string | null;
  stage: string;
  pursuitActive: boolean;
  outreachAllowed: boolean;
  hasAnalysis: boolean;
  /** The saved score was produced from the current document analysis. */
  documentScoreCurrent: boolean;
  activePairings: number;
}

export function needsSubFinder(row: SourceCandidate): boolean {
  if (!row.pursuitActive || row.status !== "open" || row.tier !== "pursue") return false;
  if (!row.outreachAllowed || !row.hasAnalysis || row.activePairings > 0) return false;
  if (row.stage === "analysis" || row.stage === "sub_research") return true;
  return row.stage === "scoring" && row.documentScoreCurrent;
}

export interface VerifyCandidate {
  tier: string | null;
  status: string | null;
  pursuitActive: boolean;
  outreachAllowed: boolean;
  removed: boolean;
  verified: boolean;
  outreachState: string;
}

export function needsSubVerify(row: VerifyCandidate): boolean {
  if (!row.pursuitActive || row.status !== "open" || row.tier !== "pursue") return false;
  if (!row.outreachAllowed || row.removed || row.verified) return false;
  return row.outreachState === "pending" || row.outreachState === "draft";
}

export interface OutreachCandidate {
  tier: string | null;
  status: string | null;
  pursuitActive: boolean;
  outreachAllowed: boolean;
  outboundEnabled: boolean;
  removed: boolean;
  verified: boolean;
  emailVerified: boolean;
  hasEmail: boolean;
  outreachState: string;
}

/** A verified email that has not been sent. Already-sent and paused accounts stay put. */
export function needsOutreach(row: OutreachCandidate): boolean {
  if (!row.outboundEnabled || !row.pursuitActive || row.status !== "open" || row.tier !== "pursue") return false;
  if (!row.outreachAllowed || row.removed || !row.verified || !row.emailVerified || !row.hasEmail) return false;
  return row.outreachState === "pending" || row.outreachState === "draft";
}
