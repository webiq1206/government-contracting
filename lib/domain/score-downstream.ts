/**
 * Which jobs scoring starts, by tier.
 *
 * A preliminary pursue starts document analysis only. Pricing and sourcing
 * begin after the analyst returns an exact-input-hash scoring job and that
 * final score still says pursue. Review also starts only the analyst: the
 * brief is the input to pursue-or-pass, not a license to start downstream work.
 *
 * Pure.
 */

import type { AgentResult, Tier } from "../types";

export function queuedAfterScore(
  tier: Tier,
  opportunityId: string
): NonNullable<AgentResult["enqueued"]> {
  if (tier === "pursue") {
    return [
      {
        agent: "solicitation-analyst",
        payload: { opportunityId, preScoring: true },
        opts: { singletonKey: `analyze:${opportunityId}`, singletonSeconds: 3600 },
      },
    ];
  }
  if (tier === "review") {
    return [
      {
        agent: "solicitation-analyst",
        payload: { opportunityId, briefOnly: true },
        opts: { singletonKey: `analyze:${opportunityId}`, singletonSeconds: 3600 },
      },
    ];
  }
  return [];
}

/**
 * Work that starts once a completed document score says pursue.
 *
 * Sub Finder enqueues Sub Verify, and a verified email enqueues Outreach.
 * Outreach writes follow_up_at, which the follow-up sweep sends.
 */
export function jobsAfterFinalPursue(
  opportunityId: string
): NonNullable<AgentResult["enqueued"]> {
  return [
    { agent: "pricing-research", payload: { opportunityId } },
    { agent: "sub-finder", payload: { opportunityId } },
  ];
}
