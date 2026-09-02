/**
 * Which jobs scoring starts, by tier.
 *
 * Pursue starts the full pipeline. Review used to start none of it, which is
 * why Overview never got a Bid Brief on the records people actually open.
 * Review now starts the analyst only: the brief is the input to pursue-or-pass,
 * not a license to source subcontractors.
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
        payload: { opportunityId },
        opts: { singletonKey: `analyze:${opportunityId}`, singletonSeconds: 3600 },
      },
      {
        agent: "pricing-research",
        payload: { opportunityId },
        opts: { singletonKey: `price:${opportunityId}`, singletonSeconds: 3600 },
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
