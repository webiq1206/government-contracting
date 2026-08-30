/**
 * The platform administrator's recap.
 *
 * A different question from the customer's. An account owner wants to know
 * what happened in their business; the person running the platform wants to
 * know which accounts are broken, which jobs are failing, whose mail is not
 * arriving, and who has gone quiet. Same shape, same renderer, same delivery
 * record, different facts.
 *
 * Every query here is deliberately unscoped, which is why the file sits beside
 * the other cross-tenant admin reads rather than in `lib/recap`'s customer
 * path... except it does live here, so the rule is stated instead: nothing in
 * this file may be imported by tenant-facing code, and the only callers are
 * the platform admin page and the platform branch of the recap agent, both of
 * which are behind `requirePlatformAdmin` or the allowlist it reads.
 */
import { query } from "../db";
import { localDayLabel } from "../domain/recap/day-window";
import {
  RECAP_SECTION_BLURBS,
  RECAP_SECTION_TITLES,
  type Recap,
  type RecapItem,
  type RecapSection,
  type RecapTotal,
} from "../domain/recap/types";

interface BrokenIntegration {
  orgId: string;
  orgName: string;
  provider: string;
  lastError: string | null;
}

interface FailingAgent {
  agent: string;
  errors: number;
  orgs: number;
  sample: string | null;
}

interface MailTrouble {
  orgId: string | null;
  orgName: string | null;
  failed: number;
}

interface QuietAccount {
  orgId: string;
  orgName: string;
  lastActivity: string | null;
  days: number;
}

export interface PlatformRecapFacts {
  brokenIntegrations: BrokenIntegration[];
  failingAgents: FailingAgent[];
  mailTrouble: MailTrouble[];
  quietAccounts: QuietAccount[];
  accounts: number;
  activeAccounts: number;
  emailsSent: number;
  emailsFailed: number;
  jobRuns: number;
  jobFailures: number;
  newOpportunities: number;
  bidsSubmitted: number;
}

/** How long an account can be silent before it is worth naming. */
const QUIET_DAYS = 7;

export async function gatherPlatformFacts(
  start: Date,
  end: Date
): Promise<PlatformRecapFacts> {
  const [
    integrations,
    agents,
    mail,
    quiet,
    counts,
  ] = await Promise.all([
    query<{ org_id: string; org_name: string; provider: string; last_error: string | null }>(
      `select t.org_id, coalesce(o.name, 'Unnamed account') as org_name,
              t.provider, t.last_error
         from integration_tokens t
         left join organizations o on o.id = t.org_id
        where t.status is distinct from 'connected'
          and t.org_id is not null
        order by t.updated_at desc nulls last
        limit 50`
    ).catch(() => []),

    query<{ agent: string; errors: number; orgs: number; sample: string | null }>(
      `select agent,
              count(*)::int as errors,
              count(distinct org_id)::int as orgs,
              (array_agg(message order by created_at desc))[1] as sample
         from agent_logs
        where status = 'error'
          and created_at >= $1 and created_at < $2
        group by agent
        order by count(*) desc
        limit 20`,
      [start, end]
    ).catch(() => []),

    query<{ org_id: string | null; org_name: string | null; failed: number }>(
      `select c.org_id, o.name as org_name, count(*)::int as failed
         from communications c
         left join organizations o on o.id = c.org_id
        where c.direction = 'outbound' and c.channel = 'email'
          and (c.delivery_state in ('bounced','failed') or c.provider is null)
          and c.created_at >= $1 and c.created_at < $2
        group by c.org_id, o.name
        having count(*) > 0
        order by count(*) desc
        limit 25`,
      [start, end]
    ).catch(() => []),

    query<{ org_id: string; org_name: string; last_activity: Date | null; days: number }>(
      `select o.id as org_id,
              coalesce(o.name, 'Unnamed account') as org_name,
              a.last_activity,
              coalesce(extract(day from (now() - a.last_activity))::int, 9999) as days
         from organizations o
         left join lateral (
           select max(created_at) as last_activity
             from agent_logs l
            where l.org_id = o.id
         ) a on true
        where a.last_activity is null
           or a.last_activity < now() - ($1 || ' days')::interval
        order by a.last_activity asc nulls first
        limit 25`,
      [String(QUIET_DAYS)]
    ).catch(() => []),

    query<{
      accounts: number;
      active_accounts: number;
      emails_sent: number;
      emails_failed: number;
      job_runs: number;
      job_failures: number;
      new_opportunities: number;
      bids_submitted: number;
    }>(
      `select
         (select count(*)::int from organizations) as accounts,
         (select count(distinct org_id)::int from agent_logs
           where created_at >= $1 and created_at < $2 and org_id is not null) as active_accounts,
         (select count(*)::int from communications
           where direction='outbound' and channel='email'
             and created_at >= $1 and created_at < $2) as emails_sent,
         (select count(*)::int from communications
           where direction='outbound' and channel='email'
             and (delivery_state in ('bounced','failed') or provider is null)
             and created_at >= $1 and created_at < $2) as emails_failed,
         (select count(*)::int from job_runs
           where started_at >= $1 and started_at < $2) as job_runs,
         (select count(*)::int from job_runs
           where status = 'error' and started_at >= $1 and started_at < $2) as job_failures,
         (select count(*)::int from opportunities
           where created_at >= $1 and created_at < $2) as new_opportunities,
         (select count(*)::int from bids
           where submitted_at >= $1 and submitted_at < $2) as bids_submitted`,
      [start, end]
    ).catch(() => []),
  ]);

  const c = counts[0];

  return {
    brokenIntegrations: integrations.map((r) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      provider: r.provider,
      lastError: r.last_error,
    })),
    failingAgents: agents.map((r) => ({
      agent: r.agent,
      errors: Number(r.errors) || 0,
      orgs: Number(r.orgs) || 0,
      sample: r.sample,
    })),
    mailTrouble: mail.map((r) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      failed: Number(r.failed) || 0,
    })),
    quietAccounts: quiet.map((r) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      lastActivity: r.last_activity instanceof Date ? r.last_activity.toISOString() : null,
      days: Number(r.days) || 0,
    })),
    accounts: Number(c?.accounts ?? 0),
    activeAccounts: Number(c?.active_accounts ?? 0),
    emailsSent: Number(c?.emails_sent ?? 0),
    emailsFailed: Number(c?.emails_failed ?? 0),
    jobRuns: Number(c?.job_runs ?? 0),
    jobFailures: Number(c?.job_failures ?? 0),
    newOpportunities: Number(c?.new_opportunities ?? 0),
    bidsSubmitted: Number(c?.bids_submitted ?? 0),
  };
}

function section(
  key: RecapSection["key"],
  emphasis: RecapSection["emphasis"],
  items: RecapItem[],
  totals: RecapTotal[],
  empty: string
): RecapSection {
  return {
    key,
    title: RECAP_SECTION_TITLES[key],
    blurb: RECAP_SECTION_BLURBS[key],
    emphasis,
    items,
    totals,
    empty,
  };
}

/**
 * The platform facts as a recap.
 *
 * Only the sections that mean something across accounts. The customer sections
 * about bids and outreach describe one business and would be meaningless
 * summed over all of them, so they are left out rather than filled with an
 * aggregate nobody can act on.
 */
export function buildPlatformRecap(
  facts: PlatformRecapFacts,
  ctx: { localDate: string; timezone: string; now: Date; partial?: boolean }
): Recap {
  const urgent: RecapItem[] = [];

  for (const m of facts.mailTrouble) {
    urgent.push({
      key: `platform-mail:${m.orgId ?? "unknown"}`,
      title: `${m.failed} email${m.failed === 1 ? "" : "s"} did not arrive for ${
        m.orgName ?? "an account with no name"
      }`,
      detail: "Outbound mail recorded as bounced, failed, or never handed to a provider.",
      href: m.orgId ? `/admin/accounts/${m.orgId}` : "/admin/health",
      reason: "Customer mail is not being delivered",
      severity: m.failed >= 5 ? "critical" : "warning",
    });
  }

  for (const a of facts.failingAgents) {
    urgent.push({
      key: `platform-agent:${a.agent}`,
      title: `${a.agent} failed ${a.errors} time${a.errors === 1 ? "" : "s"} across ${
        a.orgs
      } account${a.orgs === 1 ? "" : "s"}`,
      detail: a.sample ? a.sample.slice(0, 200) : undefined,
      href: "/admin/health",
      reason: a.orgs > 1 ? "Failing for more than one account" : "Failing",
      severity: a.orgs > 1 ? "critical" : "warning",
    });
  }

  const problems: RecapItem[] = facts.brokenIntegrations.map((i) => ({
    key: `platform-integration:${i.orgId}:${i.provider}`,
    title: `${i.provider} is disconnected for ${i.orgName}`,
    detail: i.lastError ? i.lastError.slice(0, 200) : "No error recorded.",
    href: `/admin/accounts/${i.orgId}`,
    reason: "Integration disconnected",
    severity: "warning",
  }));

  const review: RecapItem[] = facts.quietAccounts.map((q) => ({
    key: `platform-quiet:${q.orgId}`,
    title: `${q.orgName} has done nothing for ${
      q.lastActivity ? `${q.days} days` : "as long as we have recorded"
    }`,
    detail: "Worth a look before it becomes a cancellation nobody saw coming.",
    href: `/admin/accounts/${q.orgId}`,
    severity: "normal",
  }));

  const totals: RecapTotal[] = [
    { label: "Accounts", value: facts.accounts, href: "/admin/accounts" },
    { label: "Accounts that did something", value: facts.activeAccounts },
    {
      label: "Emails sent",
      value: facts.emailsSent,
      note: facts.emailsFailed > 0 ? `${facts.emailsFailed} did not arrive` : undefined,
    },
    {
      label: "Jobs run",
      value: facts.jobRuns,
      href: "/admin/health",
      note: facts.jobFailures > 0 ? `${facts.jobFailures} failed` : undefined,
    },
    { label: "New opportunities", value: facts.newOpportunities },
    { label: "Bids submitted", value: facts.bidsSubmitted },
  ];

  const sections: RecapSection[] = [
    section("urgent", "urgent", urgent, [], "No account is broken this morning."),
    section("problems", "problem", problems, [], "Every integration is connected."),
    section("review", "normal", review, [], "No account has gone quiet."),
    section("totals", "normal", [], totals, "Nothing was recorded."),
  ];

  const urgentCount = urgent.length;
  const problemCount = problems.length;
  const quiet =
    urgentCount === 0 &&
    problemCount === 0 &&
    review.length === 0 &&
    facts.jobRuns === 0 &&
    facts.emailsSent === 0;

  return {
    scope: "platform",
    orgId: null,
    orgName: "the platform",
    localDate: ctx.localDate,
    timezone: ctx.timezone,
    dayLabel: localDayLabel(ctx.localDate, ctx.timezone),
    quiet,
    urgentCount,
    problemCount,
    sections,
    generatedAt: ctx.now.toISOString(),
    partial: ctx.partial === true,
  };
}
