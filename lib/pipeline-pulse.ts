/**
 * Gathers the facts for the pipeline pulse (lib/domain/pipeline-pulse.ts
 * decides what they mean). Org-scoped: every query answers for the signed-in
 * customer's records and credentials, except worker liveness, which is a
 * platform fact (one worker moves every tenant's records).
 */
import { queryOne } from "./db";
import { orgHasKey } from "./integration-keys";
import { samDailyUsage } from "./integrations/sam";
import { gmail } from "./integrations/gmail";
import { evaluatePulse, type PulseFinding } from "./domain/pipeline-pulse";
import { readWorkerHeartbeat } from "./worker-heartbeat";
import { tryResolveTenantOrgId } from "./tenant";
import { LEGACY_ORG_ID } from "./tenant-context";
import { isAutomationPaused } from "./app-settings";
import { listActiveOrganizations } from "./organizations";
import { recentAiTrouble } from "./integration-health";

export async function readPipelinePulse(): Promise<PulseFinding[]> {
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;

  const [runs, open, samKeyPresent, claudeKeyPresent, samError, quota, connection, heartbeat, stuck, paused, activeOrgCount, aiTrouble] = await Promise.all([
    queryOne<{ worker_last: string | null; monitor_last_ok: string | null }>(
      `select (select max(started_at) from job_runs) as worker_last,
              (select max(started_at) from job_runs
                where agent = 'opportunity-monitor' and status = 'ok') as monitor_last_ok`
    ).catch(() => null),
    queryOne<{ n: number }>(
      `select count(*)::int as n from opportunities where status = 'open' and org_id = $1`,
      [orgId]
    ).catch(() => null),
    orgHasKey("SAM_API_KEY", orgId).catch(() => false),
    orgHasKey("ANTHROPIC_API_KEY", orgId).catch(() => false),
    // The monitor logs poll-sam at error level when SAM answers with a
    // failure. Two cron cycles is the honesty window: a fixed key stops
    // producing errors and the banner clears itself on the next clean run.
    queryOne<{ message: string | null }>(
      `select message from agent_logs
        where agent = 'opportunity-monitor' and action = 'poll-sam'
          and level = 'error' and org_id = $1
          and created_at > now() - interval '6 hours'
        order by created_at desc limit 1`,
      [orgId]
    ).catch(() => null),
    samDailyUsage(orgId).catch(() => ({ used: 0, cap: 0, remaining: 0 })),
    gmail
      .connection(orgId)
      .catch(() => ({ connected: false, email: null, status: "none", lastError: null })),
    // Liveness straight from the worker process. Guarded like every other
    // read here: a deployment whose schema predates the heartbeat table simply
    // reports nothing and the reading falls back to job history.
    readWorkerHeartbeat().catch(() => null),
    queryOne<{ send_failed: number; drafts: number }>(
      `select count(*) filter (where os.outreach_state = 'send_failed')::int as send_failed,
              count(*) filter (where os.outreach_state = 'draft')::int as drafts
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
        where o.org_id = $1 and o.status = 'open'`,
      [orgId]
    ).catch(() => null),
    isAutomationPaused().catch(() => false),
    /**
     * Ask the same function the scheduler asks, rather than re-deriving "who
     * is active" from subscription_status here.
     *
     * The hand-written `status in ('active','trial')` this replaces did not
     * know about billing_exempt or trial_ends_at, so a comped account (Stripe
     * says canceled, the column says full access) counted as zero, and the
     * Today page told its owner there were "no active organizations and
     * automation will not run" while the engine was in fact working for them.
     * Two screens, two selectors, one of them wrong.
     */
    listActiveOrganizations()
      .then((orgs) => orgs.length)
      .catch(() => null),
    // Did Anthropic actually refuse us recently? A configured key cannot
    // answer that; only what happened when we used it can.
    recentAiTrouble(orgId).catch(() => ({ count: 0, reason: null })),
  ]);

  return evaluatePulse({
    now: new Date(),
    workerLastRunAt: runs?.worker_last ?? null,
    workerHeartbeatAt: heartbeat?.updatedAt ?? null,
    workerPhase: heartbeat?.phase ?? null,
    workerBootedAt: heartbeat?.bootedAt ?? null,
    openCount: open?.n ?? 0,
    samKeyPresent,
    monitorLastOkAt: runs?.monitor_last_ok ?? null,
    samErrorMessage: samError?.message ?? null,
    samQuota: { used: quota.used, cap: quota.cap },
    gmail: {
      connected: connection.connected,
      status: connection.status,
      lastError: connection.lastError,
    },
    outreach: {
      sendFailed: stuck?.send_failed ?? 0,
      drafts: stuck?.drafts ?? 0,
    },
    automationPaused: paused,
    // The org's own key, like every other credential on this page. Reading
    // config.claude.enabled asked the process environment instead, which for a
    // customer is the PLATFORM's key: theirs could be missing entirely and
    // this still reported the AI as configured.
    claudeConfigured: claudeKeyPresent,
    claudeFailures: aiTrouble,
    activeOrgCount: activeOrgCount ?? undefined,
  });
}
