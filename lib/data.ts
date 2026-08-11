/**
 * Server-side data-access layer. Dashboard server components import these
 * directly (no internal HTTP hop for reads). All functions are read-only;
 * mutations go through API routes in app/api/*.
 */
import { query, queryOne } from "./db";
import type { KpiParams } from "./domain/kpi";
import { resolveSubWork } from "./domain/sub-work";
import type { ContentLibraryItem, Opportunity, Subcontractor } from "./types";

export async function queueCounts(): Promise<{ review: number; callQueue: number }> {
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) {
    return { review: 0, callQueue: 0 };
  }
  const row = await queryOne<{ review: string; call: string }>(
    `select
       (select count(*) from opportunities
         where org_id='${orgId}' and tier='review' and human_action_required=true and status='open') as review,
       (select count(*) from call_cards cc
         join opportunities o on o.id = cc.opportunity_id
         join subcontractors s on s.id = cc.subcontractor_id
        where o.org_id='${orgId}' and cc.status='pending'
          and nullif(btrim(coalesce(s.phone, '')), '') is not null) as call`
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
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return [];
  return query<Opportunity>(
    `select * from opportunities
      where org_id = $1 and stage <> 'dismissed' and status <> 'archived'
      order by (deadline is null), deadline asc
      limit 500`,
    [orgId]
  );
}

export async function reviewQueue(): Promise<Opportunity[]> {
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return [];
  return query<Opportunity>(
    `select * from opportunities
      where org_id = $1 and tier='review' and human_action_required=true and status='open'
      order by (review_expires_at is null), review_expires_at asc`,
    [orgId]
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
  value_estimated_source: string | null;
  location_state: string | null;
  /** The job site from the notice (city/base), not the sub's own city. */
  opportunity_location: string | null;
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
            o.value_estimated, o.value_estimated_source, o.location_state, o.location_text as opportunity_location,
            o.deadline, o.solicitation_number,
            o.description, o.solicitation_analysis, o.attachments_json,
            (select trade from opportunity_subs os
              where os.opportunity_id=cc.opportunity_id and os.subcontractor_id=cc.subcontractor_id limit 1) as trade
       from call_cards cc
       join subcontractors s on s.id = cc.subcontractor_id
       join opportunities o on o.id = cc.opportunity_id
      where cc.status='pending'
        and (cc.snoozed_until is null or cc.snoozed_until <= now())
        -- Uncallable cards (no phone) are never shown; Call Prep refuses to
        -- create them going forward, and this keeps historical empties off Today.
        and nullif(btrim(coalesce(s.phone, '')), '') is not null
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
            o.value_estimated, o.value_estimated_source, o.location_state, o.location_text as opportunity_location,
            o.deadline, o.solicitation_number,
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

export const EMAIL_LOG_PAGE_SIZE = 50;

export interface EmailLogRow {
  id: string;
  created_at: string;
  subject: string | null;
  body: string | null;
  provider: string | null;
  recipient_email: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  direction: string;
  // sub
  subcontractor_id: string;
  company_name: string | null;
  // opportunity
  opportunity_id: string | null;
  opportunity_title: string | null;
}

export async function emailLogPaged(opts: {
  page: number;
  q?: string;
}): Promise<{ rows: EmailLogRow[]; total: number }> {
  const { page, q } = opts;
  const offset = (Math.max(1, page) - 1) * EMAIL_LOG_PAGE_SIZE;

  const base = `
    from communications c
    join subcontractors s on s.id = c.subcontractor_id
    left join opportunities o on o.id = c.opportunity_id
    where c.channel = 'email'
      and c.direction = 'outbound'
      ${q ? `and (lower(s.company_name) like lower($3) or lower(coalesce(c.subject,'')) like lower($3))` : ""}
  `;
  const params: unknown[] = [EMAIL_LOG_PAGE_SIZE, offset];
  if (q) params.push(`%${q}%`);

  const [rows, totals] = await Promise.all([
    query<EmailLogRow>(
      `select c.id, c.created_at, c.subject, c.body, c.provider,
              c.recipient_email, c.opened_at, c.clicked_at, c.replied_at, c.direction,
              c.subcontractor_id, s.company_name,
              c.opportunity_id, o.title as opportunity_title
       ${base}
       order by c.created_at desc
       limit $1 offset $2`,
      params
    ),
    query<{ count: string }>(`select count(*)::text as count ${base}`, params.slice(2)),
  ]);

  return { rows, total: parseInt(totals[0]?.count ?? "0", 10) };
}

export interface SubCommRow {
  id: string;
  channel: string;
  direction: string | null;
  subject: string | null;
  body: string | null;
  created_at: string;
  replied_at: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  provider: string | null;
  recipient_email: string | null;
}

export interface SubContactStats {
  emails_sent: number;
  emails_in: number;
  calls_logged: number;
  notes_count: number;
  skips_logged: number;
  touches: number;
}

/** Opportunity pairings for the persistent sub record. */
export interface SubPairingRow {
  opportunity_id: string;
  opportunity_title: string | null;
  stage: string;
  deadline: string | null;
  trade: string | null;
  outreach_state: string | null;
  responded_at: string | null;
  quote_amount: number | null;
  status: string;
}

export async function subDetail(id: string) {
  let orgId: string | null = null;
  try {
    const { tryResolveTenantOrgId } = await import("./tenant");
    orgId = await tryResolveTenantOrgId();
  } catch {
    orgId = null;
  }
  const sub = orgId
    ? await queryOne<Subcontractor>(
        `select * from subcontractors where id=$1 and org_id=$2`,
        [id, orgId]
      )
    : await queryOne<Subcontractor>(`select * from subcontractors where id=$1`, [id]);
  if (!sub) return null;
  const [communications, quotes, stats, pairings] = await Promise.all([
    query<SubCommRow>(
      `select c.id, c.channel, c.direction, c.subject, c.body, c.created_at, c.replied_at,
              c.opportunity_id, o.title as opportunity_title, c.provider, c.recipient_email
         from communications c
         left join opportunities o on o.id = c.opportunity_id
        where c.subcontractor_id = $1
        order by c.created_at desc
        limit 100`,
      [id]
    ),
    query(
      `select q.*, o.title as opportunity_title, o.id as opportunity_id from quotes q
         join opportunities o on o.id=q.opportunity_id
        where q.subcontractor_id=$1 order by q.created_at desc limit 100`,
      [id]
    ),
    queryOne<SubContactStats>(
      `select
         count(*) filter (where channel = 'email' and direction = 'outbound')::int as emails_sent,
         count(*) filter (where channel = 'email' and direction = 'inbound')::int as emails_in,
         count(*) filter (where channel = 'call')::int as calls_logged,
         count(*) filter (where channel = 'note')::int as notes_count,
         count(*) filter (
           where channel = 'note' and subject ilike 'Skipped%'
         )::int as skips_logged,
         count(*)::int as touches
       from communications
       where subcontractor_id = $1`,
      [id]
    ),
    query<SubPairingRow>(
      `select os.opportunity_id, o.title as opportunity_title, o.stage, o.deadline, o.status,
              os.trade, os.outreach_state, os.responded_at,
              q.quote_amount
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
         left join lateral (
           select quote_amount
             from quotes
            where opportunity_id = os.opportunity_id
              and subcontractor_id = os.subcontractor_id
            order by created_at desc
            limit 1
         ) q on true
        where os.subcontractor_id = $1
        order by o.deadline asc nulls last, o.updated_at desc
        limit 50`,
      [id]
    ),
  ]);
  return {
    sub,
    communications,
    quotes,
    pairings,
    stats: stats ?? {
      emails_sent: 0,
      emails_in: 0,
      calls_logged: 0,
      notes_count: 0,
      skips_logged: 0,
      touches: 0,
    },
  };
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

/** Sub paired to an opportunity, with contactability + this-bid touch counts. */
export interface OppSubRow {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  trade: string | null;
  candidate_rank: number | null;
  outreach_state: string | null;
  responded_at: string | null;
  verified: boolean | null;
  company_name: string;
  phone: string | null;
  email: string | null;
  email_verified: boolean | null;
  google_rating: number | null;
  contact_status: string | null;
  last_contacted: string | null;
  emails_sent: number;
  calls_logged: number;
  notes_count: number;
  touches: number;
  last_touch_at: string | null;
  last_inbound_at: string | null;
}

/** Opportunity-scoped communication row for the Subs panel history. */
export interface OppSubCommRow {
  id: string;
  subcontractor_id: string;
  channel: string;
  direction: string | null;
  subject: string | null;
  body: string | null;
  created_at: string;
  replied_at: string | null;
}

export async function opportunityDetail(id: string) {
  // Tenant check: never return another org's opportunity by UUID guess.
  let orgId: string | null = null;
  try {
    const { tryResolveTenantOrgId } = await import("./tenant");
    orgId = await tryResolveTenantOrgId();
  } catch {
    orgId = null;
  }
  const opp = orgId
    ? await queryOne<Opportunity>(
        `select * from opportunities where id=$1 and org_id=$2`,
        [id, orgId]
      )
    : await queryOne<Opportunity>(`select * from opportunities where id=$1`, [id]);
  if (!opp) return null;
  // Independent lookups run in parallel; every list is bounded so an aged
  // opportunity can't balloon the page render.
  const [bid, quotes, subs, documents, logs, competitors, subComms] = await Promise.all([
    queryOne(`select * from bids where opportunity_id=$1 order by created_at desc limit 1`, [id]),
    query(
      `select q.*, s.company_name from quotes q left join subcontractors s on s.id=q.subcontractor_id
        where q.opportunity_id=$1 order by q.created_at desc limit 200`,
      [id]
    ),
    query<OppSubRow>(
      `select os.id, os.opportunity_id, os.subcontractor_id, os.trade, os.candidate_rank,
              os.outreach_state, os.responded_at, os.verified,
              s.company_name, s.phone, s.email, s.email_verified, s.google_rating,
              s.contact_status, s.last_contacted,
              coalesce(stats.emails_sent, 0)::int as emails_sent,
              coalesce(stats.calls_logged, 0)::int as calls_logged,
              coalesce(stats.notes_count, 0)::int as notes_count,
              coalesce(stats.touches, 0)::int as touches,
              stats.last_touch_at, stats.last_inbound_at
         from opportunity_subs os
         join subcontractors s on s.id = os.subcontractor_id
         left join lateral (
           select
             count(*) filter (where channel = 'email' and direction = 'outbound') as emails_sent,
             count(*) filter (where channel = 'call') as calls_logged,
             count(*) filter (where channel = 'note') as notes_count,
             count(*) as touches,
             max(created_at) as last_touch_at,
             max(created_at) filter (where direction = 'inbound') as last_inbound_at
           from communications c
           where c.subcontractor_id = os.subcontractor_id
             and c.opportunity_id = os.opportunity_id
         ) stats on true
        where os.opportunity_id = $1
        order by os.trade nulls last, os.candidate_rank nulls last, s.company_name
        limit 300`,
      [id]
    ),
    query(`select * from documents where opportunity_id=$1 order by created_at desc limit 100`, [id]),
    query(
      `select agent, action, level, message, reasoning, created_at from agent_logs
        where opportunity_id=$1 order by created_at desc limit 50`,
      [id]
    ),
    opportunityCompetitors(id),
    query<OppSubCommRow>(
      `select id, subcontractor_id, channel, direction, subject, body, created_at, replied_at
         from communications
        where opportunity_id = $1
        order by created_at desc
        limit 400`,
      [id]
    ),
  ]);
  return { opp, bid, quotes, subs, documents, logs, competitors, subComms };
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

export interface ActionCallRow {
  id: string;
  company_name: string;
  phone: string | null;
  opportunity_title: string | null;
  deadline: string | null;
  source: string;
  trade: string | null;
  /** Plain-English work this sub would perform (for calls / Today). */
  work_summary: string | null;
}

/** Subcontractor outreach that needs a human nudge (email follow-ups exhausted). */
export interface ActionSubFollowUpRow {
  opportunity_id: string;
  opportunity_title: string | null;
  deadline: string | null;
  subcontractor_id: string;
  company_name: string;
  phone: string | null;
  trade: string | null;
  outreach_state: string | null;
  last_contacted: string | null;
  emails_sent: number;
  calls_logged: number;
  work_summary: string | null;
}

/** Quote that looks unusually high/low and needs a quick review. */
export interface ActionQuoteReviewRow {
  quote_id: string;
  opportunity_id: string;
  opportunity_title: string | null;
  company_name: string | null;
  trade: string | null;
  quote_amount: number | null;
  deadline: string | null;
}

export interface ComplianceAlertRow {
  id: string;
  category: string;
  label: string;
  due_at: string | null;
  status: string;
  days_remaining: number | null;
}

export interface ProposedWeightsRow {
  id: string;
  version: number;
  rationale: string | null;
  proposed_at: string;
}

export interface ActionCenterData {
  /** Opportunities awaiting a pursue/dismiss decision. */
  triage: ActionOppRow[];
  /** Pending call cards: count, soonest deadline, and the top cards to call. */
  calls: { count: number; soonest_deadline: string | null; rows: ActionCallRow[] };
  /** In quote_entry or bid_building: needs quotes entered or bid reviewed. */
  bidWork: ActionOppRow[];
  /** Submitted, waiting on the agency's decision. */
  awaitingOutcome: ActionOppRow[];
  /** Deadline inside the configurable urgent window and not yet submitted. */
  urgent: ActionOppRow[];
  /** Flagged for attention outside the review queue (stalled, blocked, etc.). */
  flagged: ActionOppRow[];
  /** Subs that need a human call/follow-up after automated outreach. */
  subFollowUps: ActionSubFollowUpRow[];
  /** Out-of-range quotes waiting for operator judgment. */
  quoteReviews: ActionQuoteReviewRow[];
  /** Compliance renewals that are past "ok" (warning/critical/blocked). */
  complianceAlerts: ComplianceAlertRow[];
  /** Learning Loop scoring-weight proposals awaiting approve/reject. */
  proposedWeights: ProposedWeightsRow[];
  /** Backlink outreach drafts awaiting the operator's send approval. */
  backlinkApprovals: number;
  /** Items the operator snoozed that are still hidden (they return on their own). */
  snoozedCount: number;
  /** Open-pipeline counts per stage for the progress strip. */
  stageCounts: { stage: string; count: number }[];
}

function actionOppSelect(orgId: string): string {
  // orgId is always a UUID from our session/membership tables.
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error("Invalid organization id.");
  return `
  select o.id, o.title, o.agency, o.stage, o.deadline, o.value_estimated, o.risk_flags,
         (select count(*)::int from quotes q where q.opportunity_id = o.id) as quote_count,
         exists(select 1 from bids b where b.opportunity_id = o.id) as has_bid,
         exists(select 1 from bids b where b.opportunity_id = o.id and b.submitted_at is not null) as bid_submitted
    from opportunities o
   where o.org_id = '${orgId}'`;
}

export async function actionCenter(opts?: { urgentDays?: number }): Promise<ActionCenterData> {
  // The "do this first" window matches the configurable red deadline badge, so
  // "urgent" means the same thing everywhere (Settings → Automation rules).
  const urgentDays = Math.max(1, opts?.urgentDays ?? 3);
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  const ACTION_OPP_SELECT = actionOppSelect(orgId);
  const [
    triage,
    callRow,
    callRows,
    bidWork,
    awaitingOutcome,
    urgent,
    flagged,
    subFollowUps,
    quoteReviews,
    complianceAlerts,
    proposedWeights,
    backlinkRow,
    snoozedRow,
    stageCounts,
  ] = await Promise.all([
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT}
            and o.status='open' and o.tier='review' and o.human_action_required=true
            and (o.snoozed_until is null or o.snoozed_until <= now())
          order by (o.deadline is null), o.deadline asc limit 10`
    ),
    queryOne<{ count: number; soonest_deadline: string | null }>(
      `select count(*)::int as count, min(o.deadline) as soonest_deadline
           from call_cards cc
           join opportunities o on o.id = cc.opportunity_id
           join subcontractors s on s.id = cc.subcontractor_id
          where cc.status='pending'
            and o.org_id = '${orgId}'
            and (cc.snoozed_until is null or cc.snoozed_until <= now())
            and nullif(btrim(coalesce(s.phone, '')), '') is not null`
    ),
    query<
      Omit<ActionCallRow, "work_summary"> & {
        solicitation_analysis: Record<string, unknown> | null;
        description: string | null;
      }
    >(
      `select cc.id, s.company_name, s.phone, o.title as opportunity_title,
              o.deadline, cc.source, o.solicitation_analysis, o.description,
              (select trade from opportunity_subs os
                where os.opportunity_id=cc.opportunity_id and os.subcontractor_id=cc.subcontractor_id limit 1) as trade
         from call_cards cc
         join subcontractors s on s.id = cc.subcontractor_id
         join opportunities o on o.id = cc.opportunity_id
        where cc.status='pending'
          and o.org_id = '${orgId}'
          and (cc.snoozed_until is null or cc.snoozed_until <= now())
          and nullif(btrim(coalesce(s.phone, '')), '') is not null
        order by (cc.source='reply') desc, (o.deadline is null), o.deadline asc
        limit 6`
    ),
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT}
            and o.status='open' and o.stage in ('quote_entry','bid_building')
            and (o.snoozed_until is null or o.snoozed_until <= now())
          order by (o.deadline is null), o.deadline asc limit 10`
    ),
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT}
            and o.status='open' and o.stage='submitted'
            and (o.snoozed_until is null or o.snoozed_until <= now())
          order by o.updated_at asc limit 10`
    ),
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT}
            and o.status='open'
            and o.stage in ('analysis','sub_research','outreach','call_queue','quote_entry','bid_building')
            and o.deadline is not null and o.deadline > now()
            and o.deadline <= now() + make_interval(days => $1)
            and (o.snoozed_until is null or o.snoozed_until <= now())
          order by o.deadline asc limit 10`,
      [urgentDays]
    ),
    // `is distinct from` so records without a tier yet (e.g. a flagged
    // sources-sought notice racing its first scoring run) still surface.
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT}
            and o.status='open' and o.human_action_required=true
            and o.tier is distinct from 'review'
            and (o.snoozed_until is null or o.snoozed_until <= now())
          order by o.updated_at asc limit 10`
    ),
    // After automated email + follow-up, surface human call/nudge work so
    // operators do not have to open every opportunity to find stalled subs.
    query<
      Omit<ActionSubFollowUpRow, "work_summary"> & {
        solicitation_analysis: Record<string, unknown> | null;
        description: string | null;
      }
    >(
      `select o.id as opportunity_id, o.title as opportunity_title, o.deadline,
              s.id as subcontractor_id, s.company_name, s.phone, os.trade,
              os.outreach_state, s.last_contacted,
              o.solicitation_analysis, o.description,
              coalesce((
                select count(*)::int from communications c
                 where c.opportunity_id = os.opportunity_id
                   and c.subcontractor_id = os.subcontractor_id
                   and c.channel = 'email' and c.direction = 'outbound'
              ), 0) as emails_sent,
              coalesce((
                select count(*)::int from communications c
                 where c.opportunity_id = os.opportunity_id
                   and c.subcontractor_id = os.subcontractor_id
                   and c.channel = 'call'
              ), 0) as calls_logged
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
         join subcontractors s on s.id = os.subcontractor_id
        where o.org_id = '${orgId}'
          and o.status = 'open'
          and o.stage in ('outreach','call_queue','quote_entry','sub_research')
          and (o.snoozed_until is null or o.snoozed_until <= now())
          and os.outreach_state in ('followed_up','unresponsive')
          and not exists (
                select 1 from quotes q
                 where q.opportunity_id = os.opportunity_id
                   and q.subcontractor_id = os.subcontractor_id
                   and q.quote_amount > 0
              )
          and not exists (
                select 1 from call_cards cc
                 where cc.opportunity_id = os.opportunity_id
                   and cc.subcontractor_id = os.subcontractor_id
                   and cc.status = 'pending'
              )
        order by (o.deadline is null), o.deadline asc, s.company_name asc
        limit 12`
    ),
    query<ActionQuoteReviewRow>(
      `select q.id as quote_id, o.id as opportunity_id, o.title as opportunity_title,
              s.company_name, q.trade, q.quote_amount, o.deadline
         from quotes q
         join opportunities o on o.id = q.opportunity_id
         left join subcontractors s on s.id = q.subcontractor_id
        where o.status = 'open'
          and q.is_out_of_range = true
          and o.stage in ('quote_entry','bid_building','call_queue','outreach')
          and (o.snoozed_until is null or o.snoozed_until <= now())
        order by (o.deadline is null), o.deadline asc
        limit 10`
    ),
    query<ComplianceAlertRow>(
      `select id, category, label, due_at,
              coalesce(status_override, status) as status, days_remaining
         from compliance_items
        where coalesce(status_override, status) in ('warning','critical','blocked')
        order by case coalesce(status_override, status)
                   when 'blocked' then 0 when 'critical' then 1 else 2 end,
                 (due_at is null), due_at asc
        limit 8`
    ),
    query<ProposedWeightsRow>(
      `select id, version, rationale, proposed_at
         from scoring_weights
        where approved_at is null and proposed_by = 'learning-loop'
        order by proposed_at desc limit 3`
    ),
    queryOne<{ n: number }>(
      `select count(*)::int as n from backlink_outreach where approval_status='pending'`
    ),
    queryOne<{ n: number }>(
      `select (select count(*) from opportunities
                where status='open' and org_id='${orgId}' and snoozed_until > now())::int
           + (select count(*) from call_cards cc
                join opportunities o on o.id = cc.opportunity_id
                where cc.status='pending' and o.org_id='${orgId}' and cc.snoozed_until > now())::int as n`
    ),
    query<{ stage: string; count: number }>(
      `select stage, count(*)::int as count from opportunities
          where status='open' and org_id='${orgId}' group by stage`
    ),
  ]);

  const callsWithWork: ActionCallRow[] = callRows.map(
    ({ solicitation_analysis, description, ...row }) => ({
      ...row,
      work_summary:
        resolveSubWork({
          trade: row.trade,
          analysis: solicitation_analysis,
          description,
          maxChars: 180,
        }).work || null,
    })
  );
  const followUpsWithWork: ActionSubFollowUpRow[] = subFollowUps.map(
    ({ solicitation_analysis, description, ...row }) => ({
      ...row,
      work_summary:
        resolveSubWork({
          trade: row.trade,
          analysis: solicitation_analysis,
          description,
          maxChars: 180,
        }).work || null,
    })
  );

  return {
    triage,
    calls: {
      count: callRow?.count ?? 0,
      soonest_deadline: callRow?.soonest_deadline ?? null,
      rows: callsWithWork,
    },
    bidWork,
    awaitingOutcome,
    urgent,
    flagged,
    subFollowUps: followUpsWithWork,
    quoteReviews,
    complianceAlerts,
    proposedWeights,
    backlinkApprovals: backlinkRow?.n ?? 0,
    snoozedCount: snoozedRow?.n ?? 0,
    stageCounts,
  };
}

export interface EngineStatus {
  lastRunAt: string | null;
  openCount: number;
}

/**
 * Is the background engine (worker + scheduler) alive at all? Maintenance
 * sweeps run every 10-20 minutes, so a multi-hour silence while opportunities
 * sit open means the worker process isn't running, the single failure mode
 * that strands every record at once (e.g. a web-only deployment).
 */
export async function engineStatus(): Promise<EngineStatus> {
  const row = await queryOne<{ last_run: string | null; open_count: number }>(
    `select (select max(started_at) from job_runs) as last_run,
            (select count(*)::int from opportunities where status='open') as open_count`
  );
  return { lastRunAt: row?.last_run ?? null, openCount: row?.open_count ?? 0 };
}

export interface AgentHealth {
  runs24h: number;
  errors24h: number;
  lastRunAt: string | null;
  /** Agent with the most failures in the window, when any failed. */
  worstAgent: string | null;
}

/** One-look answer to "is the machine OK?", shown atop the Automation Log. */
export async function agentHealth(): Promise<AgentHealth> {
  const [totals, worst] = await Promise.all([
    queryOne<{ runs: number; errors: number; last_run: string | null }>(
      `select count(*)::int as runs,
              count(*) filter (where status='error')::int as errors,
              max(started_at) as last_run
         from job_runs
        where started_at > now() - interval '24 hours'`
    ),
    queryOne<{ agent: string }>(
      `select agent from job_runs
        where status='error' and started_at > now() - interval '24 hours'
        group by agent order by count(*) desc limit 1`
    ),
  ]);
  return {
    runs24h: totals?.runs ?? 0,
    errors24h: totals?.errors ?? 0,
    lastRunAt: totals?.last_run ?? null,
    worstAgent: worst?.agent ?? null,
  };
}

export interface DailyDigest {
  found: number;
  autoPursued: number;
  replies: number;
  bidsPriced: number;
  expiredArchived: number;
  callsLogged: number;
}

/**
 * What the automation did in the last 24 hours, the "while you were away"
 * strip on Today. Counts real events (rows + agent logs), never estimates.
 */
export async function dailyDigest(): Promise<DailyDigest> {
  const row = await queryOne<Record<keyof DailyDigest, number>>(
    `select
       (select count(*) from opportunities
         where created_at > now() - interval '24 hours')::int as found,
       (select count(*) from agent_logs
         where agent='scoring-engine' and action='auto-pursue'
           and created_at > now() - interval '24 hours')::int as "autoPursued",
       (select count(*) from communications
         where direction='inbound' and channel='email'
           and created_at > now() - interval '24 hours')::int as replies,
       (select count(distinct opportunity_id) from bids
         where updated_at > now() - interval '24 hours')::int as "bidsPriced",
       (select count(*) from agent_logs
         where agent='expired-opportunity-sweep' and action='archive-expired'
           and created_at > now() - interval '24 hours')::int as "expiredArchived",
       (select count(*) from agent_logs
         where agent='operator' and action='call-logged'
           and created_at > now() - interval '24 hours')::int as "callsLogged"`
  );
  return {
    found: row?.found ?? 0,
    autoPursued: row?.autoPursued ?? 0,
    replies: row?.replies ?? 0,
    bidsPriced: row?.bidsPriced ?? 0,
    expiredArchived: row?.expiredArchived ?? 0,
    callsLogged: row?.callsLogged ?? 0,
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
  contact_email: string | null;
  outreach_status: string | null;
}

/** Qualified prospects (highest priority first), excluding rejects, with any outreach state. */
export async function backlinkProspects(limit = 200): Promise<ProspectRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select p.id, p.domain, p.opportunity_type, p.domain_rating, p.relevance, p.traffic,
            p.priority_score, p.tier, p.link_type, p.status, p.qualification_json, p.contact_email,
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
    contact_email: r.contact_email == null ? null : String(r.contact_email),
    outreach_status: r.outreach_status == null ? null : String(r.outreach_status),
  }));
}

export interface OutreachActivityRow {
  id: string;
  domain: string;
  contact_email: string | null;
  subject: string | null;
  sent_at: string | null;
  replied_at: string | null;
  follow_up_sent: boolean;
  send_error: string | null;
}

/** Approved outreach and its send/reply state (the "in outreach" tracker). */
export async function outreachActivity(limit = 100): Promise<OutreachActivityRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select o.id, p.domain, p.contact_email, o.subject, o.sent_at, o.replied_at,
            o.follow_up_sent, o.send_error
       from backlink_outreach o join backlink_prospects p on p.id = o.prospect_id
      where o.approval_status = 'approved'
      order by o.replied_at desc nulls last, o.sent_at desc nulls last, o.updated_at desc
      limit $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    domain: String(r.domain),
    contact_email: r.contact_email == null ? null : String(r.contact_email),
    subject: r.subject == null ? null : String(r.subject),
    sent_at: r.sent_at == null ? null : String(r.sent_at),
    replied_at: r.replied_at == null ? null : String(r.replied_at),
    follow_up_sent: Boolean(r.follow_up_sent),
    send_error: r.send_error == null ? null : String(r.send_error),
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
