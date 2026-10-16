/**
 * One organization's recovery probe.
 *
 * The provider call, the incident write and the queue are injected so a
 * test can prove backoff, dedupe and the rescore filter without a network
 * call or a mailbox.
 */
import {
  backoffAfterFailure,
  eligibleForRescore,
  probeIsDue,
  rescoreKey,
  type RescoreRow,
} from "./provider-recovery";

export interface ProviderHold {
  provider: "OpenAI" | "Anthropic";
  refusalReason: string | null;
  attemptPending: boolean;
  nextProbeAt: Date | null;
  failureCount: number;
}

export interface RecoveryProbeDeps {
  now: () => Date;
  holds: (orgId: string) => Promise<ProviderHold[]>;
  /** The existing recovery probe. A success is what clears the refusal. */
  probe: (orgId: string, provider: ProviderHold["provider"]) => Promise<{ ok: boolean; detail: string }>;
  recordFailure: (orgId: string, provider: ProviderHold["provider"], waitMs: number) => Promise<void>;
  clearSchedule: (orgId: string, provider: ProviderHold["provider"]) => Promise<void>;
  openIncident: (orgId: string, provider: ProviderHold["provider"], reason: string) => Promise<{ id: string }>;
  /** True only for the caller that first claimed this alert. */
  claimAlert: (orgId: string, incidentId: string, kind: "start" | "end") => Promise<boolean>;
  sendAlert: (input: { orgId: string; kind: "start" | "end"; subject: string; text: string }) => Promise<void>;
  candidates: (orgId: string) => Promise<RescoreRow[]>;
  enqueueRescore: (orgId: string, opportunityId: string, singletonKey: string) => Promise<boolean>;
  markRecovered: (orgId: string, incidentId: string, note: string) => Promise<void>;
}

export interface OrgProbeResult {
  probed: string[];
  skippedPending: string[];
  skippedBackoff: string[];
  requeued: number;
  startAlerts: number;
  endAlerts: number;
}

export async function recoverOrg(orgId: string, deps: RecoveryProbeDeps): Promise<OrgProbeResult> {
  const result: OrgProbeResult = {
    probed: [],
    skippedPending: [],
    skippedBackoff: [],
    requeued: 0,
    startAlerts: 0,
    endAlerts: 0,
  };
  const now = deps.now();
  for (const hold of await deps.holds(orgId)) {
    if (!hold.refusalReason) continue;
    const incident = await deps.openIncident(orgId, hold.provider, hold.refusalReason);
    if (await deps.claimAlert(orgId, incident.id, "start")) {
      await deps.sendAlert({
        orgId,
        kind: "start",
        subject: `${hold.provider} stopped accepting AI work`,
        text:
          `${hold.provider} refused a request (${hold.refusalReason}). ` +
          "Scoring and analysis are paused for this account until a health probe succeeds. " +
          "No further outage alert will be sent for this incident.",
      });
      result.startAlerts += 1;
    }
    if (hold.attemptPending) {
      result.skippedPending.push(hold.provider);
      continue;
    }
    if (!probeIsDue({
      refusalHeld: true,
      attemptPending: false,
      nextProbeAt: hold.nextProbeAt,
      now,
    })) {
      result.skippedBackoff.push(hold.provider);
      continue;
    }
    const probed = await deps.probe(orgId, hold.provider);
    result.probed.push(hold.provider);
    if (!probed.ok) {
      await deps.recordFailure(orgId, hold.provider, backoffAfterFailure(hold.failureCount + 1));
      continue;
    }
    await deps.clearSchedule(orgId, hold.provider);
    let requeued = 0;
    for (const row of await deps.candidates(orgId)) {
      if (!eligibleForRescore(row, now)) continue;
      const queued = await deps.enqueueRescore(orgId, row.id, rescoreKey(row.id, incident.id));
      if (queued) requeued += 1;
    }
    result.requeued += requeued;
    const note = `${hold.provider} answered a health probe. ${requeued} incomplete review item(s) were queued to be scored again.`;
    if (await deps.claimAlert(orgId, incident.id, "end")) {
      await deps.sendAlert({
        orgId,
        kind: "end",
        subject: `${hold.provider} is accepting AI work again`,
        text: note,
      });
      result.endAlerts += 1;
    }
    await deps.markRecovered(orgId, incident.id, note);
  }
  return result;
}
