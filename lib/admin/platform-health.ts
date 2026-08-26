/**
 * Platform-wide health facts, read across every tenant.
 *
 * Deliberately in lib/admin: these queries have no org filter at all, which is
 * the one thing every other read in this codebase must have. Keeping them
 * beside the other cross-tenant admin reads means an accidental import from
 * customer code is obvious in review rather than invisible.
 */
import { query, queryOne } from "../db";
import type { AgentRunFacts, FailureRow, ServiceState } from "../domain/platform-health";

/** The window every figure on the page is measured over. */
export const WINDOW_HOURS = 24;

export async function agentRunFacts(): Promise<AgentRunFacts[]> {
  const rows = await query<{
    agent: string;
    runs: number;
    errors: number;
    last_run_at: Date | null;
    last_error_at: Date | null;
    sample_error: string | null;
    affected_orgs: number;
  }>(
    `select agent,
            count(*)::int as runs,
            count(*) filter (where status = 'error')::int as errors,
            max(created_at) as last_run_at,
            max(created_at) filter (where status = 'error') as last_error_at,
            (array_agg(message order by created_at desc)
               filter (where status = 'error'))[1] as sample_error,
            count(distinct org_id) filter (where status = 'error')::int as affected_orgs
       from agent_logs
      where created_at >= now() - ($1 || ' hours')::interval
      group by agent`,
    [String(WINDOW_HOURS)]
  ).catch(() => []);
  return rows.map((r) => ({
    agent: r.agent,
    runs: Number(r.runs) || 0,
    errors: Number(r.errors) || 0,
    lastRunAt: r.last_run_at instanceof Date ? r.last_run_at.toISOString() : null,
    lastErrorAt: r.last_error_at instanceof Date ? r.last_error_at.toISOString() : null,
    sampleError: r.sample_error,
    affectedOrgs: Number(r.affected_orgs) || 0,
  }));
}

/**
 * Every failure in the window, for grouping by cause.
 *
 * Capped, because an outage produces thousands of identical rows and the
 * grouping only needs enough of them to be right about which causes exist and
 * roughly how big each is. The cap is stated on the page rather than hidden,
 * so a count that has been truncated does not read as a complete one.
 */
export const FAILURE_SAMPLE_LIMIT = 2000;

export async function recentFailures(): Promise<{ rows: FailureRow[]; truncated: boolean }> {
  const rows = await query<{
    agent: string;
    org_id: string | null;
    message: string | null;
    created_at: Date;
  }>(
    `select agent, org_id, message, created_at
       from agent_logs
      where status = 'error' and created_at >= now() - ($1 || ' hours')::interval
      order by created_at desc
      limit $2`,
    [String(WINDOW_HOURS), FAILURE_SAMPLE_LIMIT]
  ).catch(() => []);
  return {
    rows: rows.map((r) => ({
      agent: r.agent,
      orgId: r.org_id,
      error: r.message,
      at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
    truncated: rows.length >= FAILURE_SAMPLE_LIMIT,
  };
}

/**
 * How much customer work is sitting behind the failures.
 *
 * Counted across every tenant, because the question this page answers is how
 * big the outage is rather than whose it is.
 */
export async function platformImpact(): Promise<{
  orgsAffected: number;
  unscored: number;
  awaitingOutreach: number;
  undeliveredEmail: number;
}> {
  const row = await queryOne<{
    orgs_affected: number;
    unscored: number;
    awaiting_outreach: number;
    undelivered: number;
  }>(
    `select
       (select count(distinct org_id)::int from agent_logs
         where status = 'error' and created_at >= now() - interval '24 hours'
           and org_id is not null) as orgs_affected,
       (select count(*)::int from opportunities
         where status = 'open' and score is null
           and stage in ('monitoring','scoring')) as unscored,
       (select count(*)::int from opportunities
         where status = 'open' and stage = 'outreach') as awaiting_outreach,
       (select count(*)::int from communications
         where direction = 'outbound' and channel = 'email'
           and delivery_state in ('bounced','failed','deferred')
           and created_at >= now() - interval '24 hours') as undelivered`
  ).catch(() => null);
  return {
    orgsAffected: Number(row?.orgs_affected ?? 0),
    unscored: Number(row?.unscored ?? 0),
    awaitingOutreach: Number(row?.awaiting_outreach ?? 0),
    undeliveredEmail: Number(row?.undelivered ?? 0),
  };
}

/**
 * The two services that are not agent-driven.
 *
 * Provider capacity is read from the failures already classified rather than
 * by calling the provider: an extra call would cost money on a page that is
 * refreshed, and it would answer about this moment rather than the window
 * everything else here describes.
 */
export function providerCapacityState(
  failures: FailureRow[]
): { state: ServiceState; detail: string } {
  const text = failures.map((f) => (f.error ?? "").toLowerCase());
  const credit = text.filter((t) => /credit balance|insufficient|too low/.test(t)).length;
  const auth = text.filter((t) => /api key|unauthori|invalid key|revoked|401|403/.test(t)).length;
  const rate = text.filter((t) => /rate limit|429|too many requests/.test(t)).length;
  if (credit > 0) {
    return {
      state: "down",
      detail: `${credit} calls refused for want of credit. Every agent that needs the model is failing.`,
    };
  }
  if (auth > 0) {
    return {
      state: "down",
      detail: `${auth} calls rejected as unauthorized. The key has been revoked, deleted or saved incompletely.`,
    };
  }
  if (rate > 0) {
    return {
      state: "degraded",
      detail: `${rate} calls hit the rate limit. Work retries on its own, more slowly.`,
    };
  }
  return { state: "healthy", detail: "No provider refusals recorded in this window." };
}
