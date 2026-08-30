/**
 * Everything that happened to one account during one local day.
 *
 * One module, one organization, one window, and an explicit org id on every
 * statement. Not `currentOrg()`: this runs inside a worker loop that walks
 * every account in turn, and a helper that resolves the tenant from ambient
 * context is exactly how one customer's morning ends up describing another
 * customer's day. The id is a parameter so the isolation is visible in every
 * query rather than trusted to a wrapper.
 *
 * The rule the whole file obeys: report what the rows say. No estimate, no
 * derived "tasks" figure, no rounding that makes a number look tidier than the
 * records behind it. Where an honest count is impossible, the fact is left out
 * rather than approximated, and where a figure has a caveat the caveat travels
 * with it.
 */
import { query, queryOne } from "../db";
import type {
  BidFact,
  CallFact,
  ComplianceFact,
  DeadlineFact,
  DraftFact,
  FailedSendFact,
  OpportunityFact,
  OutreachSubFact,
  ProblemFact,
  RecapFacts,
  RecapSettings,
  RecapTotals,
  ReplyFact,
  ReviewFact,
} from "../domain/recap/types";

export interface GatherInput {
  orgId: string;
  /** Local midnight, as an instant. */
  start: Date;
  /** The next local midnight, as an instant. */
  end: Date;
  /** Now, which may be inside the window when the page shows "today so far". */
  now: Date;
  settings: RecapSettings;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date(0).toISOString();

const isoOrNull = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === "string" && v ? v : null;

/**
 * What counts as an outbound email that did not arrive.
 *
 * Two markers, because the send path writes both and reading only one
 * undercounts: `delivery_state` records what the provider said, and a null
 * `provider` records a send that never reached a provider at all. A recap that
 * says forty emails went out on a morning the mailbox was disconnected is the
 * failure this feature is supposed to catch.
 */
const FAILED_SEND_SQL = `
  c.direction = 'outbound'
  and c.channel = 'email'
  and (c.delivery_state in ('bounced', 'failed') or c.provider is null)`;

export async function gatherRecapFacts(input: GatherInput): Promise<RecapFacts> {
  const { orgId, start, end, now, settings } = input;
  const win = [orgId, start.toISOString(), end.toISOString()];

  const [
    org,
    comms,
    opportunityCounts,
    decisions,
    quoteCount,
    submitted,
    outcomes,
    calls,
    subsAdded,
    complianceResolved,
    runs,
    discovered,
    deadlines,
    replies,
    unanswered,
    failedSends,
    compliance,
    reviewQueue,
    callQueue,
    draftsWaiting,
    outreachSent,
    agentProblems,
    integrationProblems,
    completedRows,
    exactCounts,
  ] = await Promise.all([
    queryOne<{ name: string }>(`select name from organizations where id = $1`, [orgId]),

    // Communications: sends, deliveries, failures, replies and notes in one pass.
    queryOne<Record<string, unknown>>(
      `select
         count(*) filter (where c.direction = 'outbound' and c.channel = 'email')::int as sent,
         count(*) filter (
           where c.direction = 'outbound' and c.channel = 'email' and c.delivery_state = 'delivered'
         )::int as delivered,
         count(*) filter (where ${FAILED_SEND_SQL})::int as failed,
         count(*) filter (where c.direction = 'inbound' and c.channel = 'email')::int as replies,
         count(*) filter (where c.channel = 'note')::int as notes
       from communications c
       where c.org_id = $1 and c.created_at >= $2 and c.created_at < $3`,
      win
    ),

    queryOne<Record<string, unknown>>(
      `select count(*)::int as discovered
         from opportunities
        where org_id = $1 and created_at >= $2 and created_at < $3`,
      win
    ),

    /*
     * A pursue or pass decision is a person acting, and the only place that is
     * recorded with a timestamp is the operator log the transition writes.
     * `pursuit_changed_at` is a different event (work being stopped or
     * restarted) and `updated_at` moves for every automated touch, so counting
     * either would report automation as human decisions.
     */
    query<Record<string, unknown>>(
      `select l.opportunity_id as id, l.action, l.created_at,
              o.title, o.agency, o.score, o.tier, o.deadline, o.stage, o.value_estimated
         from agent_logs l
         join opportunities o on o.id = l.opportunity_id
        where l.org_id = $1 and l.created_at >= $2 and l.created_at < $3
          and l.agent = 'operator' and l.action in ('pursue', 'dismiss')
        order by l.created_at asc
        limit 50`,
      win
    ),

    queryOne<Record<string, unknown>>(
      `select count(*)::int as n from quotes
        where org_id = $1 and created_at >= $2 and created_at < $3`,
      win
    ),

    query<Record<string, unknown>>(
      `select b.id, b.opportunity_id, b.bid_amount, b.submitted_at, o.title
         from bids b join opportunities o on o.id = b.opportunity_id
        where b.org_id = $1 and b.submitted_at >= $2 and b.submitted_at < $3
        order by b.submitted_at asc limit 25`,
      win
    ),

    // An award or a loss recorded yesterday. `updated_at` is the only stamp on
    // the outcome, so the filter also requires an outcome that means something.
    query<Record<string, unknown>>(
      `select b.id, b.opportunity_id, b.award_amount, b.bid_amount, b.outcome, b.updated_at, o.title
         from bids b join opportunities o on o.id = b.opportunity_id
        where b.org_id = $1 and b.updated_at >= $2 and b.updated_at < $3
          and b.outcome in ('won', 'lost', 'no_award')
        order by b.updated_at asc limit 25`,
      win
    ),

    query<Record<string, unknown>>(
      `select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.called_at,
              o.title as opportunity, s.company_name as subcontractor
         from call_cards cc
         left join opportunities o on o.id = cc.opportunity_id
         left join subcontractors s on s.id = cc.subcontractor_id
        where cc.org_id = $1 and cc.called_at >= $2 and cc.called_at < $3
        order by cc.called_at asc limit 50`,
      win
    ),

    queryOne<Record<string, unknown>>(
      `select count(*)::int as n from subcontractors
        where org_id = $1 and created_at >= $2 and created_at < $3`,
      win
    ),

    query<Record<string, unknown>>(
      `select id, label, category, updated_at from compliance_items
        where org_id = $1 and coalesce(status_override, status) = 'complete'
          and updated_at >= $2 and updated_at < $3
        order by updated_at asc limit 50`,
      win
    ),

    queryOne<Record<string, unknown>>(
      `select count(*)::int as total,
              count(*) filter (where status = 'error')::int as errors
         from job_runs
        where org_id = $1 and started_at >= $2 and started_at < $3`,
      win
    ),

    query<Record<string, unknown>>(
      `select id, title, agency, score, tier, deadline, stage, value_estimated
         from opportunities
        where org_id = $1 and created_at >= $2 and created_at < $3
        order by coalesce(score, 0) desc, created_at asc
        limit 25`,
      win
    ),

    /*
     * Deadlines ahead, plus the ones that slipped past in the last day so a
     * missed one is named rather than silently dropped off the list. Work that
     * was passed on, aborted or already closed is excluded: a deadline on a
     * job nobody is bidding is not a deadline.
     */
    query<Record<string, unknown>>(
      `select o.id, o.title, o.agency, o.deadline, o.stage, o.status,
              exists (
                select 1 from bids b
                 where b.opportunity_id = o.id and b.submitted_at is not null
              ) as submitted,
              (select count(*)::int from quotes q where q.opportunity_id = o.id) as quotes_in
         from opportunities o
        where o.org_id = $1
          and o.status = 'open'
          and o.pursuit_state = 'active'
          and o.stage not in ('dismissed', 'submitted', 'won', 'lost')
          and o.tier is distinct from 'dismiss'
          and o.deadline is not null
          and o.deadline >= $2::timestamptz - interval '1 day'
        order by o.deadline asc
        limit 25`,
      [orgId, now.toISOString()]
    ),

    query<Record<string, unknown>>(
      `select e.id, e.subcontractor_id, e.opportunity_id, e.intent, e.needs_review,
              e.reviewed_at, e.created_at,
              s.company_name as subcontractor, o.title as opportunity
         from subcontractor_reply_events e
         left join subcontractors s on s.id = e.subcontractor_id
         left join opportunities o on o.id = e.opportunity_id
        where e.org_id = $1 and e.created_at >= $2 and e.created_at < $3
        order by e.created_at asc limit 50`,
      win
    ),

    /*
     * Replies nobody has answered.
     *
     * "Answered" is an outbound message to the same subcontractor after they
     * wrote, which is what an operator would call answering. A reply marked
     * reviewed but never replied to still counts as waiting: reviewing a
     * message is reading it, and the subcontractor is waiting on an answer,
     * not on our filing.
     */
    query<Record<string, unknown>>(
      `select e.id, e.subcontractor_id, e.opportunity_id, e.intent, e.needs_review,
              e.reviewed_at, e.created_at,
              s.company_name as subcontractor, o.title as opportunity
         from subcontractor_reply_events e
         left join subcontractors s on s.id = e.subcontractor_id
         left join opportunities o on o.id = e.opportunity_id
        where e.org_id = $1
          and e.created_at >= $2::timestamptz - interval '21 days'
          and e.subcontractor_id is not null
          and not exists (
            select 1 from communications c
             where c.org_id = e.org_id
               and c.subcontractor_id = e.subcontractor_id
               and c.direction = 'outbound'
               and c.created_at > e.created_at
          )
        order by e.created_at asc limit 25`,
      [orgId, now.toISOString()]
    ),

    query<Record<string, unknown>>(
      `select c.id, c.subcontractor_id, c.opportunity_id, c.recipient_email,
              c.delivery_state, c.delivery_detail, c.provider, c.created_at,
              s.company_name as subcontractor
         from communications c
         left join subcontractors s on s.id = c.subcontractor_id
        where c.org_id = $1 and c.created_at >= $2 and c.created_at < $3
          and ${FAILED_SEND_SQL}
        order by c.created_at asc limit 50`,
      win
    ),

    // Compliance that is blocked, critical, or lands inside the horizon. The
    // override wins where one was set, which is what the compliance page shows.
    query<Record<string, unknown>>(
      `select id, label, category,
              coalesce(status_override, status) as status,
              coalesce(due_at_override, due_at) as due_at
         from compliance_items
        where org_id = $1
          and coalesce(status_override, status) <> 'complete'
          and (
            coalesce(status_override, status) in ('conflicting', 'expired', 'blocked')
            or (
              coalesce(due_at_override, due_at) is not null
              and coalesce(due_at_override, due_at) <= $2::timestamptz + ($3 || ' days')::interval
            )
          )
        order by coalesce(due_at_override, due_at) asc nulls last
        limit 25`,
      [orgId, now.toISOString(), String(Math.max(settings.urgent.compliance_days, 14))]
    ),

    query<Record<string, unknown>>(
      `select id, title, score, tier, review_expires_at
         from opportunities
        where org_id = $1 and status = 'open' and tier = 'review'
          and human_action_required = true
          and (snoozed_until is null or snoozed_until <= now())
        order by review_expires_at asc nulls last
        limit 25`,
      [orgId]
    ),

    query<Record<string, unknown>>(
      `select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.created_at,
              o.title as opportunity, s.company_name as subcontractor
         from call_cards cc
         join opportunities o on o.id = cc.opportunity_id
         left join subcontractors s on s.id = cc.subcontractor_id
        where cc.org_id = $1
          and cc.status = 'pending'
          and o.status = 'open'
          and (cc.snoozed_until is null or cc.snoozed_until <= now())
          and nullif(btrim(coalesce(s.phone, '')), '') is not null
        order by cc.created_at asc limit 25`,
      [orgId]
    ),

    /*
     * A drafted reply that was never sent. Same "answered" test as above: the
     * draft exists because somebody wrote in, and it stops mattering the
     * moment a person actually writes back, however they did it.
     */
    query<Record<string, unknown>>(
      `select d.id, d.subcontractor_id, d.opportunity_id, d.generated_at,
              s.company_name as subcontractor
         from reply_drafts d
         left join subcontractors s on s.id = d.subcontractor_id
        where d.org_id = $1
          and d.generated_at >= $2::timestamptz - interval '21 days'
          and (
            d.subcontractor_id is null
            or not exists (
              select 1 from communications c
               where c.org_id = d.org_id
                 and c.subcontractor_id = d.subcontractor_id
                 and c.direction = 'outbound'
                 and c.created_at > d.generated_at
            )
          )
        order by d.generated_at asc limit 25`,
      [orgId, now.toISOString()]
    ),

    query<Record<string, unknown>>(
      `select c.id, c.subcontractor_id, c.opportunity_id, c.created_at, c.delivery_state,
              s.company_name as subcontractor, o.title as opportunity
         from communications c
         left join subcontractors s on s.id = c.subcontractor_id
         left join opportunities o on o.id = c.opportunity_id
        where c.org_id = $1 and c.created_at >= $2 and c.created_at < $3
          and c.direction = 'outbound' and c.channel = 'email'
        order by c.created_at asc limit 100`,
      win
    ),

    /*
     * Automation that failed, grouped by agent. One line per agent rather than
     * one per run: a scoring engine that failed thirty times overnight is one
     * problem with a count, and thirty lines would bury everything else.
     */
    query<Record<string, unknown>>(
      `select agent, count(*)::int as n, max(created_at) as last_at,
              (array_agg(message order by created_at desc))[1] as message
         from agent_logs
        where org_id = $1 and created_at >= $2 and created_at < $3
          and status = 'error'
        group by agent
        order by n desc limit 10`,
      win
    ),

    // An integration that is telling us it is broken. Read straight from the
    // stored connection state, which is what the integrations page shows.
    query<Record<string, unknown>>(
      `select provider, status, last_error, updated_at
         from integration_tokens
        where org_id = $1 and status is not null and status <> 'ok'
        order by updated_at desc limit 10`,
      [orgId]
    ),

    /*
     * Work that finished. Deliberately the same five sources the Today page
     * calls "completed", so the recap and the page cannot disagree about what
     * finishing means.
     */
    query<Record<string, unknown>>(
      `select 'call' as kind, cc.id::text as id, cc.called_at as at,
              coalesce(s.company_name, 'a subcontractor') as label,
              o.title as detail, cc.opportunity_id::text as opportunity_id
         from call_cards cc
         left join subcontractors s on s.id = cc.subcontractor_id
         left join opportunities o on o.id = cc.opportunity_id
        where cc.org_id = $1 and cc.called_at >= $2 and cc.called_at < $3
       union all
       select 'quote', q.id::text, q.created_at,
              coalesce(s.company_name, 'a subcontractor'), o.title, q.opportunity_id::text
         from quotes q
         left join subcontractors s on s.id = q.subcontractor_id
         left join opportunities o on o.id = q.opportunity_id
        where q.org_id = $1 and q.created_at >= $2 and q.created_at < $3
       union all
       select 'bid', b.id::text, b.submitted_at, o.title, null, b.opportunity_id::text
         from bids b join opportunities o on o.id = b.opportunity_id
        where b.org_id = $1 and b.submitted_at >= $2 and b.submitted_at < $3
       union all
       select 'compliance', ci.id::text, ci.updated_at, ci.label, ci.category, null
         from compliance_items ci
        where ci.org_id = $1 and coalesce(ci.status_override, ci.status) = 'complete'
          and ci.updated_at >= $2 and ci.updated_at < $3
        order by at asc
        limit 60`,
      win
    ),

    /*
     * The counts, separately from the lists.
     *
     * Every list above is capped, because a mail with four hundred lines in it
     * is not a recap. Counting the rows that survived the cap would then make
     * the totals disagree with the day itself: twenty-six bids submitted would
     * be reported as twenty-five, and the number nobody can check is the one
     * people trust. So the lists stay capped for readability and the totals
     * are counted here in full, and where a list is truncated the section says
     * so rather than quietly shortening the day.
     */
    queryOne<Record<string, unknown>>(
      `select
         (select count(*)::int from agent_logs l
           where l.org_id = $1 and l.created_at >= $2 and l.created_at < $3
             and l.agent = 'operator' and l.action in ('pursue', 'dismiss')
             and exists (select 1 from opportunities o where o.id = l.opportunity_id)
         ) as decisions,
         (select count(*)::int from bids b
           where b.org_id = $1 and b.submitted_at >= $2 and b.submitted_at < $3
             and exists (select 1 from opportunities o where o.id = b.opportunity_id)
         ) as bids_submitted,
         (select count(*)::int from call_cards cc
           where cc.org_id = $1 and cc.called_at >= $2 and cc.called_at < $3
         ) as calls,
         (select count(*)::int from compliance_items ci
           where ci.org_id = $1
             and coalesce(ci.status_override, ci.status) = 'complete'
             and ci.updated_at >= $2 and ci.updated_at < $3
         ) as compliance_resolved,
         (select count(*)::int from subcontractor_reply_events e
           where e.org_id = $1 and e.created_at >= $2 and e.created_at < $3
             and e.needs_review = true
         ) as replies_needing_review,
         (select count(*)::int from reply_drafts d
           where d.org_id = $1 and d.generated_at >= $2 and d.generated_at < $3
         ) as drafts_generated`,
      win
    ),
  ]);

  const totals: RecapTotals = {
    opportunitiesDiscovered: num(opportunityCounts?.discovered),
    decisionsMade: num(exactCounts?.decisions),
    outreachSent: num(comms?.sent),
    outreachDelivered: num(comms?.delivered),
    outreachFailed: num(comms?.failed),
    repliesReceived: num(comms?.replies),
    repliesNeedingReview: num(exactCounts?.replies_needing_review),
    draftsGenerated: num(exactCounts?.drafts_generated),
    callsLogged: num(exactCounts?.calls),
    quotesRecorded: num(quoteCount?.n),
    bidsSubmitted: num(exactCounts?.bids_submitted),
    notesAdded: num(comms?.notes),
    subsAdded: num(subsAdded?.n),
    complianceResolved: num(exactCounts?.compliance_resolved),
    agentRuns: num(runs?.total),
    agentRunErrors: num(runs?.errors),
  };

  const problems: ProblemFact[] = [];
  for (const row of agentProblems) {
    const agent = String(row.agent ?? "an automation");
    problems.push({
      key: `agent-error:${agent}`,
      title: `${agent} failed`,
      detail: row.message ? String(row.message).slice(0, 200) : null,
      count: num(row.n),
      lastAt: isoOrNull(row.last_at),
      href: "/agents",
      // A repeated failure is a broken automation; a single one is usually a
      // blip that the next run clears.
      severity: num(row.n) >= 3 ? "critical" : "warning",
    });
  }
  for (const row of integrationProblems) {
    const provider = String(row.provider ?? "an integration");
    problems.push({
      key: `integration:${provider}`,
      title: `${provider} is not working`,
      detail: row.last_error ? String(row.last_error).slice(0, 200) : `Status: ${row.status}`,
      count: 1,
      lastAt: isoOrNull(row.updated_at),
      href: "/settings/integrations",
      /*
       * Mail is critical whatever the status says: an outreach mailbox that
       * cannot send stops the pipeline at its narrowest point, and everything
       * downstream looks quiet rather than broken.
       */
      severity: /gmail|mail|smtp/i.test(provider) ? "critical" : "warning",
    });
  }

  return {
    orgId,
    orgName: org?.name ?? null,
    totals,
    deadlines: deadlines.map(
      (r): DeadlineFact => ({
        id: String(r.id),
        title: String(r.title ?? "Untitled solicitation"),
        agency: (r.agency as string) ?? null,
        deadline: iso(r.deadline),
        stage: String(r.stage ?? ""),
        status: String(r.status ?? ""),
        submitted: r.submitted === true,
        quotesIn: num(r.quotes_in),
      })
    ),
    replies: replies.map(toReply),
    unansweredReplies: unanswered.map(toReply),
    failedSends: failedSends.map(
      (r): FailedSendFact => ({
        id: String(r.id),
        subcontractorId: (r.subcontractor_id as string) ?? null,
        subcontractor: (r.subcontractor as string) ?? null,
        recipient: (r.recipient_email as string) ?? null,
        opportunityId: (r.opportunity_id as string) ?? null,
        state: String(r.delivery_state ?? (r.provider == null ? "never sent" : "unknown")),
        detail: (r.delivery_detail as string) ?? null,
        createdAt: iso(r.created_at),
      })
    ),
    compliance: compliance.map(
      (r): ComplianceFact => ({
        id: String(r.id),
        label: String(r.label ?? "Compliance item"),
        category: (r.category as string) ?? null,
        status: String(r.status ?? "unknown"),
        dueAt: isoOrNull(r.due_at),
      })
    ),
    reviewQueue: reviewQueue.map(
      (r): ReviewFact => ({
        id: String(r.id),
        title: String(r.title ?? "Untitled solicitation"),
        score: r.score == null ? null : num(r.score),
        tier: (r.tier as string) ?? null,
        expiresAt: isoOrNull(r.review_expires_at),
      })
    ),
    callQueue: callQueue.map(
      (r): CallFact => ({
        id: String(r.id),
        opportunityId: (r.opportunity_id as string) ?? null,
        opportunity: (r.opportunity as string) ?? null,
        subcontractorId: (r.subcontractor_id as string) ?? null,
        subcontractor: (r.subcontractor as string) ?? null,
        createdAt: iso(r.created_at),
      })
    ),
    draftsWaiting: draftsWaiting.map(
      (r): DraftFact => ({
        id: String(r.id),
        subcontractorId: (r.subcontractor_id as string) ?? null,
        subcontractor: (r.subcontractor as string) ?? null,
        opportunityId: (r.opportunity_id as string) ?? null,
        generatedAt: iso(r.generated_at),
      })
    ),
    problems,
    discovered: discovered.map(toOpportunity),
    decided: decisions.map((r) => ({
      ...toOpportunity(r),
      decision: r.action === "pursue" ? "pursuing" : "passed",
    })),
    submitted: submitted.map(
      (r): BidFact => ({
        id: String(r.id),
        opportunityId: String(r.opportunity_id),
        title: String(r.title ?? "Untitled solicitation"),
        amount: r.bid_amount == null ? null : num(r.bid_amount),
        outcome: null,
        at: iso(r.submitted_at),
      })
    ),
    outcomes: outcomes.map(
      (r): BidFact => ({
        id: String(r.id),
        opportunityId: String(r.opportunity_id),
        title: String(r.title ?? "Untitled solicitation"),
        amount: r.award_amount == null ? (r.bid_amount == null ? null : num(r.bid_amount)) : num(r.award_amount),
        outcome: (r.outcome as string) ?? null,
        at: iso(r.updated_at),
      })
    ),
    outreachSent: outreachSent.map(
      (r): OutreachSubFact => ({
        id: String(r.id),
        subcontractor: (r.subcontractor as string) ?? null,
        subcontractorId: (r.subcontractor_id as string) ?? null,
        opportunityId: (r.opportunity_id as string) ?? null,
        opportunity: (r.opportunity as string) ?? null,
        state: String(r.delivery_state ?? "sent"),
        at: iso(r.created_at),
      })
    ),
    completed: completedRows.map((r) => {
      const kind = String(r.kind);
      const label =
        kind === "call"
          ? `Called ${r.label}`
          : kind === "quote"
            ? `Quote recorded from ${r.label}`
            : kind === "bid"
              ? `Bid submitted: ${r.label}`
              : `Compliance resolved: ${r.label}`;
      return {
        key: `${kind}:${r.id}`,
        label,
        detail: (r.detail as string) ?? null,
        href: r.opportunity_id
          ? `/opportunity/${r.opportunity_id}`
          : kind === "compliance"
            ? "/compliance"
            : undefined,
        at: iso(r.at),
      };
    }),
  };
}

function toReply(r: Record<string, unknown>): ReplyFact {
  return {
    id: String(r.id),
    subcontractorId: (r.subcontractor_id as string) ?? null,
    subcontractor: (r.subcontractor as string) ?? null,
    opportunityId: (r.opportunity_id as string) ?? null,
    opportunity: (r.opportunity as string) ?? null,
    intent: (r.intent as string) ?? null,
    needsReview: r.needs_review === true,
    reviewedAt: isoOrNull(r.reviewed_at),
    createdAt: iso(r.created_at),
  };
}

function toOpportunity(r: Record<string, unknown>): OpportunityFact {
  return {
    id: String(r.id),
    title: String(r.title ?? "Untitled solicitation"),
    agency: (r.agency as string) ?? null,
    score: r.score == null ? null : num(r.score),
    tier: (r.tier as string) ?? null,
    deadline: isoOrNull(r.deadline),
    stage: String(r.stage ?? ""),
    value: r.value_estimated == null ? null : num(r.value_estimated),
  };
}
