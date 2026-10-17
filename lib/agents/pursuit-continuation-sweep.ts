/**
 * Re-queue a pursue handoff that never started, or that was interrupted.
 *
 * This job is on its own clock. It does not wait for a provider probe or for
 * the scoring recovery sweep, so a dropped enqueue cannot sit until some
 * other job happens to run.
 */
import type { AgentDefinition, AgentResult } from "./types";
import { orgsToSweep, fanoutNote } from "./org-fanout";
import { recoverOpenPursuitGaps } from "../domain/pursuit-recovery-run";

export const pursuitContinuationSweep: AgentDefinition = {
  name: "pursuit-continuation-sweep",
  label: "Pursuit continuation",
  description:
    "Queues a missing band decision, subcontractor search, verification, or quote request when that step never started or was interrupted.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const fanout = await orgsToSweep("pursuit-continuation-sweep");
    if (fanout.error) {
      return { ok: false, summary: fanoutNote(fanout) ?? "No accounts were processed." };
    }
    const gaps = await recoverOpenPursuitGaps(fanout.orgs.map((org) => org.id));
    const parts: string[] = [];
    if (gaps.bandQueued > 0) {
      parts.push(
        `queued a band decision for ${gaps.bandQueued} finished 50-69 score${gaps.bandQueued === 1 ? "" : "s"} that had none`
      );
    }
    if (gaps.sourcingQueued > 0) {
      parts.push(`queued sourcing for ${gaps.sourcingQueued} pursue item${gaps.sourcingQueued === 1 ? "" : "s"} with no pairing`);
    }
    if (gaps.verifyQueued > 0) {
      parts.push(`queued verification for ${gaps.verifyQueued} unverified pairing${gaps.verifyQueued === 1 ? "" : "s"}`);
    }
    if (gaps.outreachQueued > 0) {
      parts.push(`queued ${gaps.outreachQueued} quote request${gaps.outreachQueued === 1 ? "" : "s"} for a verified email`);
    }
    if (gaps.parked > 0) {
      parts.push(`parked ${gaps.parked} item${gaps.parked === 1 ? "" : "s"} for a person after the retry cap`);
    }
    if (gaps.queueFailures > 0) {
      parts.push(
        `${gaps.queueFailures} continuation job${gaps.queueFailures === 1 ? "" : "s"} could not be queued`
      );
    }
    return {
      ok: gaps.queueFailures === 0,
      summary: parts.length > 0 ? `${parts.join("; ")}.` : "No dropped pursue handoffs were waiting.",
      data: {
        bandQueued: gaps.bandQueued,
        sourcingQueued: gaps.sourcingQueued,
        verifyQueued: gaps.verifyQueued,
        outreachQueued: gaps.outreachQueued,
        parked: gaps.parked,
        queueFailures: gaps.queueFailures,
        alerted: gaps.alerted,
        resolved: gaps.resolved,
      },
      humanActionRequired: gaps.parked > 0 || gaps.queueFailures > 0,
    };
  },
};
