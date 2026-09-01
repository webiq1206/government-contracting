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

  const [paused, heartbeat, totals, errors, latestOk, stalled, configured, backlog] = await Promise.all([
    getAutomationState()
      .then((s) => s.paused)
      .catch(() => false),
    readWorkerHeartbeat().catch(() => null),
    query<{ runs: number; errors: number }>(
      `select count(*)::int as runs,
              count(*) filter (where status = 'error')::int as errors
         from agent_logs
        where org_id = $1
          and created_at > now() - interval '${WINDOW}'
          and status in ('ok','error')`,
      [org]
    )
      .then((r) => r[0] ?? { runs: 0, errors: 0 })
      .catch(() => ({ runs: 0, errors: 0 })),
    // Every failure in the window, not the newest 500 mixed rows. A busy
    // scoring engine used to push analyst failures out of the sample so the
    // sidebar printed "Running normally" over a failing reader.
    query<LogRow>(
      `select agent, status, created_at::text, message
         from agent_logs
        where org_id = $1
          and created_at > now() - interval '${WINDOW}'
          and status = 'error'
        order by created_at desc
        limit 500`,
      [org]
    ).catch(() => [] as LogRow[]),
    query<LogRow>(
      `select agent, status, created_at::text, message
         from agent_logs
        where org_id = $1
          and created_at > now() - interval '${WINDOW}'
          and status = 'ok'
        order by created_at desc
        limit 1`,
      [org]
    ).catch(() => [] as LogRow[]),
    query<{ n: number }>(
      `select count(*)::int as n
         from opportunities
        where org_id = $1 and status = 'open'
          and coalesce(pursuit_state, 'active') <> 'aborted'
          and stage not in ('submitted','won','lost')`,
      [org]
    )
      .then((r) => r[0]?.n ?? 0)
      .catch(() => 0),
    // "Has automation ever been set up" is a question about credentials, and
    // the AI key is the one every core agent needs. Without it nothing scores,
    // analyses or drafts, so its absence is the honest definition of "not
    // configured" rather than a fault to report.
    orgHasKey("ANTHROPIC_API_KEY", org).catch(() => true),
    queueBacklogDepth().catch(() => null),
  ]);

  const rows = [...errors, ...latestOk];
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
    backlog,
    configured,
    affectedOpportunities: stalled,
    windowRuns: totals.runs,
    windowErrors: totals.errors,
  });
}

/**
 * Jobs waiting to be picked up. Counted from pg-boss when that is the
 * backend. Null when the table is not there or Redis is in use, because
 * reporting those as zero is how a growing backlog stays invisible.
 */
export async function queueBacklogDepth(): Promise<number | null> {
  const { config } = await import("./config");
  if (config.queue.backend !== "pgboss") return null;
  const { queryOne } = await import("./db");
  const exists = await queryOne<{ job: string | null }>(
    `select to_regclass('pgboss.job')::text as job`
  );
  if (!exists?.job) return null;
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from pgboss.job where state in ('created', 'retry')`
  );
  return row?.n ?? 0;
}
