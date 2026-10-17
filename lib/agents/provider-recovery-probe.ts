/**
 * Retest a provider that has refused work, then put unfinished scoring back.
 *
 * The runner skips AI agents while a refusal is held. This agent is
 * deliberately allowed to run without that clearance so it can make the one
 * probe the refusal permits. A successful probe clears the refusal through
 * the existing recovery path. This file does not write refusal_reason.
 */
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { runWithOrg } from "../tenant-context";
import { fanoutNote, orgsToSweep } from "./org-fanout";
import { enqueue } from "../queue";
import { advance, IllegalTransition, openOrUpdateIncident } from "../incidents";
import { getAutomationRules } from "../app-settings";
import { probeProviderRecovery } from "../ai/claude";
import { currentProviderEvidence, recordProviderProbe } from "../ai/provider-facts";
import { runHoldSweepCycle } from "./hold-sweep";
import { deliverOutageAlert } from "../outage-alert";
import { recoverOrg, type ProviderHold } from "../domain/provider-recovery-run";
import { providerRefusalCause } from "../domain/provider-recovery";
import { SCORING_STALL_CAUSE } from "../domain/scoring-watchdog";
import { watchScoring } from "../domain/scoring-watchdog-run";
import { addBusinessDays } from "../domain/review-lead";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";
import type { AiProvider } from "../ai/routing";

const PROVIDERS: AiProvider[] = ["OpenAI", "Anthropic"];

async function holdsFor(orgId: string): Promise<ProviderHold[]> {
  const holds: ProviderHold[] = [];
  for (const provider of PROVIDERS) {
    const evidence = await currentProviderEvidence(provider, orgId);
    const facts = evidence.facts;
    holds.push({
      provider,
      refusalReason: facts?.refusal_reason ?? null,
      attemptPending: Boolean(facts?.pending_attempt),
      nextProbeAt: facts?.next_probe_at ? new Date(facts.next_probe_at) : null,
      failureCount: Number(facts?.probe_failure_count ?? 0),
    });
  }
  return holds;
}

async function claimAlert(orgId: string, incidentId: string, kind: "start" | "end"): Promise<boolean> {
  const row = kind === "start"
    ? await queryOne<{ id: string }>(
        `update automation_incidents
            set start_alert_at = now()
          where id = $1 and org_id = $2 and start_alert_at is null
          returning id`,
        [incidentId, orgId]
      )
    : await queryOne<{ id: string }>(
        `update automation_incidents
            set end_alert_at = now()
          where id = $1 and org_id = $2 and end_alert_at is null
          returning id`,
        [incidentId, orgId]
      );
  return Boolean(row);
}

async function markRecovered(orgId: string, incidentId: string, note: string): Promise<void> {
  const steps = ["mitigating", "provider_restored", "test_passed", "recovered"] as const;
  for (const step of steps) {
    try {
      await advance({
        incidentId,
        orgId,
        to: step,
        actor: "ai-provider-recovery-probe",
        detail: step === "recovered" ? note : undefined,
        set:
          step === "test_passed"
            ? { testRanAt: new Date(), testPassed: true, testDetail: note }
            : step === "recovered"
              ? { recoveryNote: note, recoveryOwner: "ai-provider-recovery-probe", testPassed: true }
              : undefined,
      });
    } catch (error) {
      if (!(error instanceof IllegalTransition)) throw error;
    }
  }
}

export const providerRecoveryProbe: AgentDefinition = {
  name: "ai-provider-recovery-probe",
  label: "AI provider recovery probe",
  description:
    "Retests a refused AI provider and, when it answers, queues scoring again for open review items that were left incomplete.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const fanout = await orgsToSweep("ai-provider-recovery-probe");
    if (fanout.error) {
      return { ok: false, summary: fanoutNote(fanout) ?? "No accounts were processed." };
    }
    await runHoldSweepCycle().catch((error) => {
      console.error(
        "[ai-provider-recovery-probe] hold sweep failed:",
        error instanceof Error ? error.message : error
      );
    });
    let probed = 0;
    let requeued = 0;
    let startAlerts = 0;
    let endAlerts = 0;
    for (const org of fanout.orgs) {
      const outcome = await runWithOrg(org.id, async () => {
        const rules = await getAutomationRules();
        const rescoreAfter =
          rules.min_bid_lead_business_days > 0
            ? addBusinessDays(new Date(), rules.min_bid_lead_business_days)
            : new Date(Date.now() + 24 * 60 * 60_000);
        const recovered = await recoverOrg(org.id, {
          now: () => new Date(),
          leadBusinessDays: rules.min_bid_lead_business_days,
          holds: holdsFor,
          probe: async (orgId, provider) => {
            try {
              const completion = await probeProviderRecovery(provider, orgId);
              const text = completion.text.trim();
              return { ok: text.length > 0, detail: text ? "The provider answered." : "The provider returned nothing." };
            } catch (error) {
              return { ok: false, detail: error instanceof Error ? error.message : "The probe failed." };
            }
          },
          recordFailure: async (orgId, provider, waitMs) => {
            await recordProviderProbe(orgId, provider, { ok: false, waitMs });
          },
          clearSchedule: async (orgId, provider) => {
            await recordProviderProbe(orgId, provider, { ok: true });
          },
          openIncident: async (orgId, provider, reason) => {
            const row = await openOrUpdateIncident({
              orgId,
              cause: providerRefusalCause(provider),
              severity: "blocking",
              provider: provider.toLowerCase(),
              startedAt: new Date(),
              detectionSource: "provider_recovery_probe",
              failedCount: 1,
              recommendedAction: reason,
            });
            return { id: row.id };
          },
          claimAlert,
          sendAlert: async (alert) => {
            const delivered = await deliverOutageAlert({ subject: alert.subject, text: alert.text });
            await logAgent({
              agent: "ai-provider-recovery-probe",
              action: alert.kind === "start" ? "outage-alert" : "recovery-alert",
              level: delivered === "unconfigured" ? "warn" : "info",
              message:
                delivered === "unconfigured"
                  ? `An outage alert was not delivered because operator email could not be sent. ${alert.text}`
                  : alert.text,
            });
          },
          candidates: (orgId) =>
            query<{
              id: string;
              tier: string | null;
              status: string | null;
              stage: string;
              risk_flags: string[] | null;
              deadline: Date | null;
            }>(
              `select id, tier, status, stage, risk_flags, deadline
                 from opportunities
                where org_id = $1
                  and status = 'open'
                  and tier = 'review'
                  and stage in ('monitoring', 'scoring')
                  and 'incomplete_scoring' = any(coalesce(risk_flags, '{}'))
                  and deadline is not null
                  and deadline >= $2`,
              [orgId, rescoreAfter.toISOString()]
            ).then((rows) =>
              rows.map((row) => ({
                id: row.id,
                tier: row.tier,
                status: row.status,
                stage: row.stage,
                riskFlags: row.risk_flags ?? [],
                deadline: row.deadline,
              }))
            ),
          enqueueRescore: async (orgId, opportunityId, singletonKey) => {
            const queued = await enqueue(
              "scoring-engine",
              { opportunityId, trigger: "provider-recovery" },
              { orgId, singletonKey }
            );
            return Boolean(queued);
          },
          markRecovered,
        });
        const watch = await watchScoring(org.id, {
        counts: async (id) => {
          const scores = await queryOne<{ n: number }>(
            `select count(*)::int as n from agent_logs
              where org_id = $1 and agent = 'scoring-engine' and action = 'score'
                and created_at >= now() - interval '24 hours'
                and message like 'scored via Claude%'
                and message not like '%incomplete%'`,
            [id]
          );
          const arrived = await queryOne<{ n: number }>(
            `select count(*)::int as n from opportunities
              where org_id = $1 and created_at >= now() - interval '24 hours'`,
            [id]
          );
          return { completedScores: Number(scores?.n ?? 0), arrived: Number(arrived?.n ?? 0) };
        },
        incidentOpen: async (id) =>
          queryOne<{ id: string }>(
            `select id from automation_incidents
              where org_id = $1 and cause = $2 and state <> 'recovered'
              limit 1`,
            [id, SCORING_STALL_CAUSE]
          ),
        openIncident: async (id) => {
          const row = await openOrUpdateIncident({
            orgId: id,
            cause: SCORING_STALL_CAUSE,
            severity: "blocking",
            startedAt: new Date(),
            detectionSource: "scoring_watchdog",
            failedCount: 1,
            recommendedAction: "Wait for the provider probe, then confirm a score finishes.",
          });
          return { id: row.id };
        },
        claimAlert,
        sendAlert: async (alert) => {
          const delivered = await deliverOutageAlert({ subject: alert.subject, text: alert.text });
          await logAgent({
            agent: "ai-provider-recovery-probe",
            action: alert.kind === "start" ? "scoring-stall-alert" : "scoring-stall-cleared",
            level: delivered === "unconfigured" ? "warn" : "info",
            message: alert.text,
          });
        },
        markRecovered,
        });
        if (watch.alerted) startAlerts += 1;
        if (watch.resolved) endAlerts += 1;
        return recovered;
      });
      probed += outcome.probed.length;
      requeued += outcome.requeued;
      startAlerts += outcome.startAlerts;
      endAlerts += outcome.endAlerts;
    }
    return {
      ok: true,
      summary: `Provider probe: tested ${probed}, re-queued ${requeued}, outage alerts ${startAlerts}, recovery alerts ${endAlerts}.`,
      data: { probed, requeued, startAlerts, endAlerts },
    };
  },
};
