/**
 * The facts behind the one automation state, gathered for the current
 * organization.
 *
 * Split from lib/domain/automation-health.ts on purpose: that module decides
 * what the facts mean and is pure, this one goes and gets them and is not.
 * The decision is the part worth testing exhaustively, and it cannot be tested
 * exhaustively while it is welded to four queries and a heartbeat.
 *
 * Failures are read from `agent_logs` rather than `job_runs`. Both record what
 * the agents did, but only agent_logs carries `org_id`: job_runs is a
 * platform-wide table (it is in the RLS bypass list), so counting failures
 * there would tell one customer about another customer's outage and would put
 * a stranger's failure rate in their sidebar. Liveness still comes from the
 * worker heartbeat, which is genuinely platform-wide and genuinely the same
 * answer for everyone.
 */
import { query } from "./db";
import { tryResolveTenantOrgId } from "./tenant";
import { LEGACY_ORG_ID } from "./tenant-context";
import { getAutomationState } from "./app-settings";
import { readWorkerHeartbeat } from "./worker-heartbeat";
import { orgHasKey } from "./integration-keys";
import { assessAutomation, type AutomationHealth, type RunFact } from "./domain/automation-health";
import { ROSTER } from "./agents/registry";

/** agent name -> the label an operator would recognise. */
const LABELS = new Map(ROSTER.map((a) => [a.name, a.label]));

/** Twenty-four hours: long enough to catch an overnight stall, short enough
 *  that a fixed problem stops being reported the same day it was fixed. */
const WINDOW = "24 hours";

interface LogRow {
  agent: string;
  status: string;
  created_at: string;
  message: string | null;
}

export async function automationHealth(orgId?: string): Promise<AutomationHealth> {
  const org = orgId ?? (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(org)) {
    // No resolvable tenant is not an outage; there is simply nothing to report.
    return assessAutomation({ paused: false, runs: [], backlog: null });
  }

  const [paused, heartbeat, rows, stalled, configured] = await Promise.all([
    getAutomationState()
      .then((s) => s.paused)
      .catch(() => false),
    readWorkerHeartbeat().catch(() => null),
    query<LogRow>(
      `select agent, status, created_at::text, message
         from agent_logs
        where org_id = $1
          and created_at > now() - interval '${WINDOW}'
          and status in ('ok','error')
        order by created_at desc
        limit 500`,
      [org]
    ).catch(() => [] as LogRow[]),
    query<{ n: number }>(
      `select count(*)::int as n
         from opportunities
        where org_id = $1 and status = 'open' and stage not in ('submitted','won','lost')`,
      [org]
    )
      .then((r) => r[0]?.n ?? 0)
      .catch(() => 0),
    // "Has automation ever been set up" is a question about credentials, and
    // the AI key is the one every core agent needs. Without it nothing scores,
    // analyses or drafts, so its absence is the honest definition of "not
    // configured" rather than a fault to report.
    orgHasKey("ANTHROPIC_API_KEY", org).catch(() => true),
  ]);

  const runs: RunFact[] = rows.map((r) => ({
    agent: r.agent,
    label: LABELS.get(r.agent) ?? r.agent,
    status: r.status === "error" ? "error" : "ok",
    startedAt: r.created_at,
    error: r.status === "error" ? r.message : null,
  }));

  return assessAutomation({
    paused,
    heartbeatAt: heartbeat?.updatedAt ?? null,
    phase: heartbeat?.phase ?? null,
    runs,
    // Left unknown rather than guessed: the queue lives in pg-boss's own
    // schema when Postgres is the backend and in Redis when it is not, so
    // there is no one count to read, and reporting an unknown as zero is how
    // a growing backlog stays invisible.
    backlog: null,
    configured,
    affectedOpportunities: stalled,
  });
}
