/**
 * Server-side data-access layer. Dashboard server components import these
 * directly (no internal HTTP hop for reads). All functions are read-only;
 * mutations go through API routes in app/api/*.
 */
import { query, queryOne } from "./db";
import type { KpiParams } from "./domain/kpi";
import type { ContentLibraryItem, Opportunity, Subcontractor } from "./types";

export async function queueCounts(): Promise<{ review: number; callQueue: number }> {
  const row = await queryOne<{ review: string; call: string }>(
    `select
       (select count(*) from opportunities where tier='review' and human_action_required=true and status='open') as review,
       (select count(*) from call_cards where status='pending') as call`
  );
  return { review: Number(row?.review ?? 0), callQueue: Number(row?.call ?? 0) };
}

export const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: "monitoring", label: "Monitoring" },
  { key: "scoring", label: "Scoring" },
  { key: "analysis", label: "Analysis" },
  { key: "sub_research", label: "Sub Research" },
  { key: "outreach", label: "Outreach" },
  { key: "call_queue", label: "Call Queue" },
  { key: "quote_entry", label: "Quote Entry" },
  { key: "bid_building", label: "Bid Building" },
  { key: "submitted", label: "Submitted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

export async function pipelineOpportunities(): Promise<Opportunity[]> {
  return query<Opportunity>(
    `select * from opportunities
      where stage <> 'dismissed' and status <> 'archived'
      order by (deadline is null), deadline asc
      limit 500`
  );
}

export async function reviewQueue(): Promise<Opportunity[]> {
  return query<Opportunity>(
    `select * from opportunities
      where tier='review' and human_action_required=true and status='open'
      order by (review_expires_at is null), review_expires_at asc`
  );
}

/**
 * A CallCardRow carries everything the Call Workspace needs to render on a
 * single screen, contractor contact info, project context (scope, agency,
 * value, deadline), attachments, prior comms, prior quotes, and the SOW-derived
 * script + question list. Building the whole workspace off one query means the
 * operator never has to click into a second page during a call.
 */
export interface CallCardRow {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  card_json: Record<string, unknown>;
  call_script: string | null;
  question_list: string[] | null;
  needs_project_history: boolean;
  status: string;
  /** 'reply' = the sub responded; 'outreach' = cold follow-up after we emailed. */
  source: string;
  response_json: Record<string, unknown> | null;
  quote_amount: number | null;
  // Contractor
  company_name: string;
  owner_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  google_rating: number | null;
  reliability_score: number | null;
  license_status: string | null;
  sam_excluded: boolean;
  trade_categories: string[] | null;
  // Opportunity
  opportunity_title: string | null;
  agency: string | null;
  naics_code: string | null;
  set_aside_type: string | null;
  value_estimated: number | null;
  location_state: string | null;
  deadline: string | null;
  solicitation_number: string | null;
  description: string | null;
  solicitation_analysis: Record<string, unknown> | null;
  attachments_json: unknown[] | null;
  // Contextual (per-call)
  trade: string | null;
}

export async function callQueue(): Promise<CallCardRow[]> {
  return query<CallCardRow>(
    `select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.card_json, cc.call_script,
            cc.question_list, cc.needs_project_history, cc.status, cc.source,
            cc.response_json, cc.quote_amount,
            s.company_name, s.owner_name, s.email, s.phone, s.website, s.address,
            s.city, s.state, s.google_rating, s.reliability_score, s.license_status,
            s.sam_excluded, s.trade_categories,
            o.title as opportunity_title, o.agency, o.naics_code, o.set_aside_type,
            o.value_estimated, o.location_state, o.deadline, o.solicitation_number,
            o.description, o.solicitation_analysis, o.attachments_json,
            (select trade from opportunity_subs os
              where os.opportunity_id=cc.opportunity_id and os.subcontractor_id=cc.subcontractor_id limit 1) as trade
       from call_cards cc
       join subcontractors s on s.id = cc.subcontractor_id
       join opportunities o on o.id = cc.opportunity_id
      where cc.status='pending'
      order by (cc.source='reply') desc, (o.deadline is null), o.deadline asc`
  );
}

/**
 * Fetch ONE call card with its full workspace projection, regardless of status
 * (so a completed card can be reopened for review). Same shape as callQueue().
 */
export async function callCardById(id: string): Promise<CallCardRow | null> {
  return queryOne<CallCardRow>(
    `select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.card_json, cc.call_script,
            cc.question_list, cc.needs_project_history, cc.status, cc.source,
            cc.response_json, cc.quote_amount,
            s.company_name, s.owner_name, s.email, s.phone, s.website, s.address,
            s.city, s.state, s.google_rating, s.reliability_score, s.license_status,
            s.sam_excluded, s.trade_categories,
            o.title as opportunity_title, o.agency, o.naics_code, o.set_aside_type,
            o.value_estimated, o.location_state, o.deadline, o.solicitation_number,
            o.description, o.solicitation_analysis, o.attachments_json,
            (select trade from opportunity_subs os
              where os.opportunity_id=cc.opportunity_id and os.subcontractor_id=cc.subcontractor_id limit 1) as trade
       from call_cards cc
       join subcontractors s on s.id = cc.subcontractor_id
       join opportunities o on o.id = cc.opportunity_id
      where cc.id=$1`,
    [id]
  );
}

/** Fetch prior communications + quotes for the (sub, opp) pair, used by the Call Workspace. */
export async function callCardHistory(subId: string, oppId: string) {
  const [communications, quotes] = await Promise.all([
    query(
      `select id, channel, direction, subject, body, created_at, replied_at
         from communications
        where subcontractor_id=$1 and opportunity_id=$2
        order by created_at desc limit 20`,
      [subId, oppId]
    ),
    query(
      `select id, trade, quote_amount, payment_terms, is_out_of_range, created_at
         from quotes where subcontractor_id=$1 and opportunity_id=$2
        order by created_at desc limit 50`,
      [subId, oppId]
    ),
  ]);
  return { communications, quotes };
}

export interface SubFilters {
  trade?: string;
  state?: string;
  minReliability?: number;
  activeOnly?: boolean;
  q?: string;
}

export async function subDatabase(filters: SubFilters = {}): Promise<Subcontractor[]> {
  const where: string[] = ["blacklisted = false"];
  const params: unknown[] = [];
  if (filters.trade) {
    params.push(filters.trade);
    where.push(`$${params.length} = any(trade_categories)`);
  }
  if (filters.state) {
    params.push(filters.state);
    where.push(`state = $${params.length}`);
  }
  if (filters.minReliability != null) {
    params.push(filters.minReliability);
    where.push(`coalesce(reliability_score,0) >= $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(company_name ilike $${params.length} or coalesce(owner_name,'') ilike $${params.length})`);
  }
  return query<Subcontractor>(
    `select * from subcontractors where ${where.join(" and ")}
      order by is_preferred desc, coalesce(reliability_score,0) desc, company_name asc
      limit 500`,
    params
  );
}

export async function subDetail(id: string) {
  const sub = await queryOne<Subcontractor>(`select * from subcontractors where id=$1`, [id]);
  if (!sub) return null;
  const [communications, quotes] = await Promise.all([
    query(
      `select * from communications where subcontractor_id=$1 order by created_at desc limit 50`,
      [id]
    ),
    query(
      `select q.*, o.title as opportunity_title from quotes q
         join opportunities o on o.id=q.opportunity_id
        where q.subcontractor_id=$1 order by q.created_at desc limit 100`,
      [id]
    ),
  ]);
  return { sub, communications, quotes };
}

export async function complianceBoard() {
  const items = await query(
    `select ci.*, c.contract_number
       from compliance_items ci
       left join contracts c on c.id = ci.contract_id
      order by
        case ci.status when 'blocked' then 0 when 'critical' then 1 when 'warning' then 2 else 3 end,
        (ci.due_at is null), ci.due_at asc`
  );
  return items;
}

export async function activeContracts() {
  return query(
    `select c.*, o.title as opportunity_title,
            ps.company_name as primary_sub_name,
            bs.company_name as backup_sub_name
       from contracts c
       left join opportunities o on o.id = c.opportunity_id
       left join subcontractors ps on ps.id = c.primary_sub_id
       left join subcontractors bs on bs.id = c.backup_sub_id
      where c.status='active'
      order by c.end_date asc nulls last`
  );
}

/** Contracts no longer active (completed/closed), for the Past contracts view. */
export async function completedContracts() {
  return query(
    `select c.*, o.title as opportunity_title,
            ps.company_name as primary_sub_name,
            bs.company_name as backup_sub_name
       from contracts c
       left join opportunities o on o.id = c.opportunity_id
       left join subcontractors ps on ps.id = c.primary_sub_id
       left join subcontractors bs on bs.id = c.backup_sub_id
      where c.status <> 'active'
      order by c.end_date desc nulls last, c.updated_at desc`
  );
}

export async function latestKpiSnapshot(): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ output_json: Record<string, unknown> }>(
    `select output_json from agent_logs
      where agent='analytics-engine' and action='kpi-snapshot'
      order by created_at desc limit 1`
  );
  return row?.output_json ?? null;
}

/** Live-computed KPIs as a fallback when the Analytics Engine hasn't run yet. */
export async function computeKpisFallback() {
  const row = await queryOne<{
    won: string;
    lost: string;
    avg_margin: string | null;
    pipeline_value: string | null;
    active_revenue: string | null;
  }>(
    `select
       (select count(*) from bids where outcome='won') as won,
       (select count(*) from bids where outcome='lost') as lost,
       (select avg(margin_pct) from bids where outcome='won') as avg_margin,
       (select sum(value_estimated) from opportunities where stage not in ('dismissed','lost') and status='open') as pipeline_value,
       (select sum(c.award_amount) from contracts c
          left join opportunities o on o.id = c.opportunity_id
         where c.status='active' and (o.id is null or o.status <> 'archived')) as active_revenue`
  );
  const won = Number(row?.won ?? 0);
  const lost = Number(row?.lost ?? 0);
  return {
    win_rate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    wins: won,
    losses: lost,
    avg_margin_on_wins: row?.avg_margin ? Math.round(Number(row.avg_margin)) : null,
    pipeline_value: Number(row?.pipeline_value ?? 0),
    active_contract_revenue: Number(row?.active_revenue ?? 0),
  };
}

/**
 * Live built-in analytics that don't depend on the AI Analytics Engine snapshot,
 * so the dashboard is useful the moment there's data: current pipeline counts and
 * the value sitting in each stage.
 */
export async function analyticsExtras(): Promise<{
  counts: { open_opps: number; new_30d: number; bids_30d: number; active_contracts: number };
  byStage: { stage: string; count: number; value: number }[];
}> {
  const [counts, byStage] = await Promise.all([
    queryOne<{ open_opps: number; new_30d: number; bids_30d: number; active_contracts: number }>(
      `select
         (select count(*)::int from opportunities where status='open' and stage not in ('dismissed','lost')) as open_opps,
         (select count(*)::int from opportunities where created_at >= now() - interval '30 days') as new_30d,
         (select count(*)::int from bids where submitted_at is not null and submitted_at >= now() - interval '30 days') as bids_30d,
         (select count(*)::int from contracts where status='active') as active_contracts`
    ),
    query<{ stage: string; count: number; value: number }>(
      `select stage, count(*)::int as count, coalesce(sum(value_estimated),0)::float8 as value
         from opportunities
        where status='open' and stage not in ('dismissed','lost')
        group by stage`
    ),
  ]);
  return {
    counts: counts ?? { open_opps: 0, new_30d: 0, bids_30d: 0, active_contracts: 0 },
    byStage,
  };
}

export interface CustomKpiRow {
  id: string;
  label: string;
  metric: string;
  params: KpiParams;
  sort_order: number;
}

/** Operator-defined KPI definitions for the Analytics dashboard. [] pre-migration. */
export async function customKpis(): Promise<CustomKpiRow[]> {
  try {
    return await query<CustomKpiRow>(
      `select id, label, metric, params, sort_order from custom_kpis
        order by sort_order asc, created_at asc limit 50`
    );
  } catch {
    return [];
  }
}

/**
 * Compute one custom KPI. Each metric maps to a fixed, bounded, parameterized
 * query (no free-form SQL), and every failure returns null so a bad definition
 * or a not-yet-migrated table can't break the dashboard. Percent metrics return
 * a 0..100 number; currency/count return the raw number.
 */
export async function computeCustomKpi(metric: string, params: KpiParams): Promise<number | null> {
  const days = params.days ?? 0;
  const minScore = params.minScore ?? 0;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    switch (metric) {
      case "open_opportunities": {
        const r = await queryOne<{ n: number }>(
          `select count(*)::int as n from opportunities
            where status='open' and stage not in ('dismissed','lost') and coalesce(score,0) >= $1`,
          [minScore]
        );
        return Number(r?.n ?? 0);
      }
      case "pipeline_value": {
        const r = await queryOne<{ n: number }>(
          `select coalesce(sum(value_estimated),0)::float8 as n from opportunities
            where status='open' and stage not in ('dismissed','lost') and coalesce(score,0) >= $1`,
          [minScore]
        );
        return Number(r?.n ?? 0);
      }
      case "opportunities_added": {
        const r = await queryOne<{ n: number }>(
          `select count(*)::int as n from opportunities where created_at >= $1`,
          [since]
        );
        return Number(r?.n ?? 0);
      }
      case "bids_submitted": {
        const r = await queryOne<{ n: number }>(
          `select count(*)::int as n from bids where submitted_at is not null and submitted_at >= $1`,
          [since]
        );
        return Number(r?.n ?? 0);
      }
      case "win_rate": {
        const r = await queryOne<{ won: number; decided: number }>(
          `select count(*) filter (where outcome='won')::int as won,
                  count(*) filter (where outcome in ('won','lost'))::int as decided
             from bids
            where ($1::boolean is false or submitted_at >= $2)`,
          [days > 0, since]
        );
        const won = Number(r?.won ?? 0);
        const decided = Number(r?.decided ?? 0);
        return decided > 0 ? (won / decided) * 100 : null;
      }
      case "avg_margin": {
        const r = await queryOne<{ n: number | null }>(
          `select avg(margin_pct)::float8 as n from bids where outcome='won'`
        );
        return r?.n != null ? Number(r.n) : null;
      }
      case "active_contracts": {
        const r = await queryOne<{ n: number }>(
          `select count(*)::int as n from contracts where status='active'`
        );
        return Number(r?.n ?? 0);
      }
      case "active_contract_revenue": {
        const r = await queryOne<{ n: number }>(
          `select coalesce(sum(award_amount),0)::float8 as n from contracts where status='active'`
        );
        return Number(r?.n ?? 0);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export async function agentLogs(filters: { agent?: string; limit?: number } = {}) {
  const params: unknown[] = [];
  let where = "";
  if (filters.agent) {
    params.push(filters.agent);
    where = `where agent = $${params.length}`;
  }
  params.push(filters.limit ?? 200);
  return query(
    `select id, agent, action, level, status, message, reasoning, opportunity_id,
            duration_ms, claude_usage, created_at
       from agent_logs ${where}
      order by created_at desc limit $${params.length}`,
    params
  );
}

export const LOG_PAGE_SIZE = 50;

/** Paged + filterable activity feed for the Automation Log page. */
export async function agentLogsPaged(filters: {
  agent?: string;
  level?: string;
  q?: string;
  page?: number;
}): Promise<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.agent) {
    params.push(filters.agent);
    where.push(`agent = $${params.length}`);
  }
  if (filters.level) {
    // "warn" should also match legacy "warning" rows.
    params.push(filters.level === "warn" ? ["warn", "warning"] : [filters.level]);
    where.push(`level = any($${params.length})`);
  }
  if (filters.q && filters.q.trim()) {
    params.push(`%${filters.q.trim()}%`);
    where.push(
      `(message ilike $${params.length} or action ilike $${params.length} or reasoning ilike $${params.length})`
    );
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const page = Math.max(1, filters.page ?? 1);
  const countParams = [...params];
  params.push(LOG_PAGE_SIZE, (page - 1) * LOG_PAGE_SIZE);
  const [rows, totalRow] = await Promise.all([
    query(
      `select id, agent, action, level, status, message, reasoning, opportunity_id,
              duration_ms, created_at
         from agent_logs ${whereSql}
        order by created_at desc
        limit $${params.length - 1} offset $${params.length}`,
      params
    ),
    queryOne<{ total: number }>(
      `select count(*)::int as total from agent_logs ${whereSql}`,
      countParams
    ),
  ]);
  return { rows, total: totalRow?.total ?? 0, page, pageSize: LOG_PAGE_SIZE };
}

export async function jobRunsSummary() {
  return query(
    `select agent,
            count(*) filter (where status='ok') as ok,
            count(*) filter (where status='error') as error,
            max(started_at) as last_run
       from job_runs
      group by agent order by max(started_at) desc nulls last`
  );
}

/**
 * One competing firm's footprint in this opportunity's NAICS + state, rolled up
 * from the CPI-adjusted pricing_comps the Pricing Research agent already stores.
 * Numeric aggregates are cast to float8 in SQL so they arrive as JS numbers.
 */
export interface CompetitorRow {
  recipient_name: string;
  award_count: number;
  total_adj: number;
  median_adj: number;
  last_award_at: string | null;
  is_incumbent: boolean;
}

/**
 * Competitive landscape for one opportunity: every firm that has won work in
 * the same NAICS + state over the comp window, ranked by how often they win.
 * Reuses the pricing_comps rows already gathered at the pursue tier, so it
 * needs no new API calls and lights up on every opportunity that has been
 * priced. Bounded to keep the render cheap (comps are ≤100 per opportunity).
 */
export async function opportunityCompetitors(id: string): Promise<CompetitorRow[]> {
  return query<CompetitorRow>(
    `select recipient_name,
            count(*)::int                                                   as award_count,
            coalesce(sum(award_amount_adj), 0)::float8                       as total_adj,
            coalesce(percentile_cont(0.5) within group
              (order by award_amount_adj), 0)::float8                       as median_adj,
            max(awarded_at)::text                                           as last_award_at,
            bool_or(is_incumbent)                                           as is_incumbent
       from pricing_comps
      where opportunity_id = $1
        and recipient_name is not null and btrim(recipient_name) <> ''
      group by recipient_name
      order by award_count desc, total_adj desc
      limit 50`,
    [id]
  );
}

export async function opportunityDetail(id: string) {
  const opp = await queryOne<Opportunity>(`select * from opportunities where id=$1`, [id]);
  if (!opp) return null;
  // Independent lookups run in parallel; every list is bounded so an aged
  // opportunity can't balloon the page render.
  const [bid, quotes, subs, documents, logs, competitors] = await Promise.all([
    queryOne(`select * from bids where opportunity_id=$1 order by created_at desc limit 1`, [id]),
    query(
      `select q.*, s.company_name from quotes q left join subcontractors s on s.id=q.subcontractor_id
        where q.opportunity_id=$1 order by q.created_at desc limit 200`,
      [id]
    ),
    query(
      `select os.*, s.company_name, s.phone, s.email, s.email_verified, s.google_rating
         from opportunity_subs os join subcontractors s on s.id=os.subcontractor_id
        where os.opportunity_id=$1 order by os.trade, os.candidate_rank limit 300`,
      [id]
    ),
    query(`select * from documents where opportunity_id=$1 order by created_at desc limit 100`, [id]),
    query(
      `select agent, action, level, message, reasoning, created_at from agent_logs
        where opportunity_id=$1 order by created_at desc limit 50`,
      [id]
    ),
    opportunityCompetitors(id),
  ]);
  return { opp, bid, quotes, subs, documents, logs, competitors };
}

export async function pricingSummaryFor(opp: Opportunity): Promise<Record<string, unknown> | null> {
  const raw = opp.raw_json as { pricing_summary?: Record<string, unknown> } | null;
  return raw?.pricing_summary ?? null;
}

/**
 * Every content-library snippet, for the management screen. Returns [] if the
 * table hasn't been migrated yet so the settings page still renders its empty
 * state instead of erroring.
 */
export async function contentLibrary(): Promise<ContentLibraryItem[]> {
  try {
    return await query<ContentLibraryItem>(
      `select * from content_library
        order by is_active desc, category asc, updated_at desc
        limit 500`
    );
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------ */
/* Action Center, powers the guided "Today" home page.                      */
/* ------------------------------------------------------------------------ */

export interface ActionOppRow {
  id: string;
  title: string | null;
  agency: string | null;
  stage: string;
  deadline: string | null;
  value_estimated: number | null;
  risk_flags: string[] | null;
  quote_count: number;
  has_bid: boolean;
  bid_submitted: boolean;
}

export interface ActionCenterData {
  /** Opportunities awaiting a pursue/dismiss decision. */
  triage: ActionOppRow[];
  /** Pending call cards (count + soonest deadline). */
  calls: { count: number; soonest_deadline: string | null };
  /** In quote_entry or bid_building: needs quotes entered or bid reviewed. */
  bidWork: ActionOppRow[];
  /** Submitted, waiting on the agency's decision. */
  awaitingOutcome: ActionOppRow[];
  /** Deadline within 72h and not yet submitted. */
  urgent: ActionOppRow[];
  /** Flagged for attention outside the review queue (stalled, blocked, etc.). */
  flagged: ActionOppRow[];
  /** Open-pipeline counts per stage for the progress strip. */
  stageCounts: { stage: string; count: number }[];
}

const ACTION_OPP_SELECT = `
  select o.id, o.title, o.agency, o.stage, o.deadline, o.value_estimated, o.risk_flags,
         (select count(*)::int from quotes q where q.opportunity_id = o.id) as quote_count,
         exists(select 1 from bids b where b.opportunity_id = o.id) as has_bid,
         exists(select 1 from bids b where b.opportunity_id = o.id and b.submitted_at is not null) as bid_submitted
    from opportunities o`;

export async function actionCenter(): Promise<ActionCenterData> {
  const [triage, callRow, bidWork, awaitingOutcome, urgent, flagged, stageCounts] =
    await Promise.all([
      query<ActionOppRow>(
        `${ACTION_OPP_SELECT}
          where o.status='open' and o.tier='review' and o.human_action_required=true
          order by (o.deadline is null), o.deadline asc limit 10`
      ),
      queryOne<{ count: number; soonest_deadline: string | null }>(
        `select count(*)::int as count, min(o.deadline) as soonest_deadline
           from call_cards cc join opportunities o on o.id = cc.opportunity_id
          where cc.status='pending'`
      ),
      query<ActionOppRow>(
        `${ACTION_OPP_SELECT}
          where o.status='open' and o.stage in ('quote_entry','bid_building')
          order by (o.deadline is null), o.deadline asc limit 10`
      ),
      query<ActionOppRow>(
        `${ACTION_OPP_SELECT}
          where o.status='open' and o.stage='submitted'
          order by o.updated_at asc limit 10`
      ),
      query<ActionOppRow>(
        `${ACTION_OPP_SELECT}
          where o.status='open'
            and o.stage in ('analysis','sub_research','outreach','call_queue','quote_entry','bid_building')
            and o.deadline is not null and o.deadline > now()
            and o.deadline <= now() + interval '72 hours'
          order by o.deadline asc limit 10`
      ),
      query<ActionOppRow>(
        `${ACTION_OPP_SELECT}
          where o.status='open' and o.human_action_required=true and o.tier <> 'review'
          order by o.updated_at asc limit 10`
      ),
      query<{ stage: string; count: number }>(
        `select stage, count(*)::int as count from opportunities
          where status='open' group by stage`
      ),
    ]);
  return {
    triage,
    calls: callRow ?? { count: 0, soonest_deadline: null },
    bidWork,
    awaitingOutcome,
    urgent,
    flagged,
    stageCounts,
  };
}

// --- Site Authority / backlink module ---

export interface AuthorityOverview {
  latest: { domain_rating: number | null; referring_domains: number | null; backlinks_total: number | null; captured_at: string } | null;
  first: { domain_rating: number | null; captured_at: string } | null;
  trend: { domain_rating: number | null; captured_at: string }[];
}

/** Latest authority snapshot + a trend series (most recent 60 points). */
export async function authorityOverview(): Promise<AuthorityOverview> {
  const rows = await query<{ domain_rating: string | null; referring_domains: number | null; backlinks_total: number | null; captured_at: string }>(
    `select domain_rating, referring_domains, backlinks_total, captured_at
       from authority_snapshots order by captured_at desc limit 60`
  );
  const asNum = (v: string | null) => (v == null ? null : Number(v));
  const latest = rows[0]
    ? { domain_rating: asNum(rows[0].domain_rating), referring_domains: rows[0].referring_domains, backlinks_total: rows[0].backlinks_total, captured_at: rows[0].captured_at }
    : null;
  const first = rows.length
    ? { domain_rating: asNum(rows[rows.length - 1].domain_rating), captured_at: rows[rows.length - 1].captured_at }
    : null;
  const trend = [...rows].reverse().map((r) => ({ domain_rating: asNum(r.domain_rating), captured_at: r.captured_at }));
  return { latest, first, trend };
}

export interface ProspectRow {
  id: string;
  domain: string;
  opportunity_type: string;
  domain_rating: number | null;
  relevance: number | null;
  traffic: number | null;
  priority_score: number | null;
  tier: string | null;
  link_type: string | null;
  status: string;
  qualification_json: unknown;
  outreach_status: string | null;
}

/** Qualified prospects (highest priority first), excluding rejects, with any outreach state. */
export async function backlinkProspects(limit = 200): Promise<ProspectRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select p.id, p.domain, p.opportunity_type, p.domain_rating, p.relevance, p.traffic,
            p.priority_score, p.tier, p.link_type, p.status, p.qualification_json,
            (select o.approval_status from backlink_outreach o
               where o.prospect_id = p.id order by o.created_at desc limit 1) as outreach_status
       from backlink_prospects p
      where p.tier is not null and p.tier <> 'reject'
      order by p.priority_score desc nulls last
      limit $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    domain: String(r.domain),
    opportunity_type: String(r.opportunity_type),
    domain_rating: r.domain_rating == null ? null : Number(r.domain_rating),
    relevance: r.relevance == null ? null : Number(r.relevance),
    traffic: r.traffic == null ? null : Number(r.traffic),
    priority_score: r.priority_score == null ? null : Number(r.priority_score),
    tier: r.tier == null ? null : String(r.tier),
    link_type: r.link_type == null ? null : String(r.link_type),
    status: String(r.status),
    qualification_json: r.qualification_json,
    outreach_status: r.outreach_status == null ? null : String(r.outreach_status),
  }));
}

export interface OutreachRow {
  id: string;
  prospect_id: string;
  domain: string;
  channel: string;
  subject: string | null;
  body: string | null;
  approval_status: string;
  created_at: string;
  sent_at: string | null;
}

/** Drafted outreach awaiting a human decision (the approval gate). */
export async function outreachQueue(status = "pending"): Promise<OutreachRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select o.id, o.prospect_id, p.domain, o.channel, o.subject, o.body,
            o.approval_status, o.created_at, o.sent_at
       from backlink_outreach o join backlink_prospects p on p.id = o.prospect_id
      where o.approval_status = $1
      order by p.priority_score desc nulls last, o.created_at desc`,
    [status]
  );
  return rows.map((r) => ({
    id: String(r.id),
    prospect_id: String(r.prospect_id),
    domain: String(r.domain),
    channel: String(r.channel),
    subject: r.subject == null ? null : String(r.subject),
    body: r.body == null ? null : String(r.body),
    approval_status: String(r.approval_status),
    created_at: String(r.created_at),
    sent_at: r.sent_at == null ? null : String(r.sent_at),
  }));
}

export interface BacklinkChange {
  source_domain: string;
  domain_rating: number | null;
  link_type: string | null;
  first_seen_at: string;
  last_seen_at: string;
  lost_at: string | null;
}

/** Recent backlink changes: newest live links and recently-lost links. */
export async function backlinkChanges(): Promise<{ recent: BacklinkChange[]; lost: BacklinkChange[]; liveCount: number }> {
  const map = (r: Record<string, unknown>): BacklinkChange => ({
    source_domain: String(r.source_domain),
    domain_rating: r.domain_rating == null ? null : Number(r.domain_rating),
    link_type: r.link_type == null ? null : String(r.link_type),
    first_seen_at: String(r.first_seen_at),
    last_seen_at: String(r.last_seen_at),
    lost_at: r.lost_at == null ? null : String(r.lost_at),
  });
  const recent = await query<Record<string, unknown>>(
    `select source_domain, domain_rating, link_type, first_seen_at, last_seen_at, lost_at
       from backlinks where lost_at is null order by first_seen_at desc limit 25`
  );
  const lost = await query<Record<string, unknown>>(
    `select source_domain, domain_rating, link_type, first_seen_at, last_seen_at, lost_at
       from backlinks where lost_at is not null order by lost_at desc limit 25`
  );
  const live = await queryOne<{ n: string }>(`select count(*)::text as n from backlinks where lost_at is null`);
  return { recent: recent.map(map), lost: lost.map(map), liveCount: Number(live?.n ?? 0) };
}
