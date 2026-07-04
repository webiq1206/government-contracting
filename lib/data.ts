/**
 * Server-side data-access layer. Dashboard server components import these
 * directly (no internal HTTP hop for reads). All functions are read-only;
 * mutations go through API routes in app/api/*.
 */
import { query, queryOne } from "./db";
import type { Opportunity, Subcontractor } from "./types";

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

export interface CallCardRow {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  card_json: Record<string, unknown>;
  call_script: string | null;
  question_list: string[] | null;
  needs_project_history: boolean;
  status: string;
  company_name: string;
  phone: string | null;
  trade: string | null;
  opportunity_title: string | null;
  deadline: string | null;
}

export async function callQueue(): Promise<CallCardRow[]> {
  return query<CallCardRow>(
    `select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.card_json, cc.call_script,
            cc.question_list, cc.needs_project_history, cc.status,
            s.company_name, s.phone,
            o.title as opportunity_title, o.deadline,
            (select trade from opportunity_subs os
              where os.opportunity_id=cc.opportunity_id and os.subcontractor_id=cc.subcontractor_id limit 1) as trade
       from call_cards cc
       join subcontractors s on s.id = cc.subcontractor_id
       join opportunities o on o.id = cc.opportunity_id
      where cc.status='pending'
      order by (o.deadline is null), o.deadline asc`
  );
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
  const communications = await query(
    `select * from communications where subcontractor_id=$1 order by created_at desc limit 50`,
    [id]
  );
  const quotes = await query(
    `select q.*, o.title as opportunity_title from quotes q
       join opportunities o on o.id=q.opportunity_id
      where q.subcontractor_id=$1 order by q.created_at desc`,
    [id]
  );
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
       (select sum(award_amount) from contracts where status='active') as active_revenue`
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

export async function opportunityDetail(id: string) {
  const opp = await queryOne<Opportunity>(`select * from opportunities where id=$1`, [id]);
  if (!opp) return null;
  const bid = await queryOne(`select * from bids where opportunity_id=$1 order by created_at desc limit 1`, [id]);
  const quotes = await query(
    `select q.*, s.company_name from quotes q left join subcontractors s on s.id=q.subcontractor_id
      where q.opportunity_id=$1 order by q.created_at desc`,
    [id]
  );
  const subs = await query(
    `select os.*, s.company_name, s.phone, s.email, s.email_verified, s.google_rating
       from opportunity_subs os join subcontractors s on s.id=os.subcontractor_id
      where os.opportunity_id=$1 order by os.trade, os.candidate_rank`,
    [id]
  );
  const documents = await query(`select * from documents where opportunity_id=$1 order by created_at desc`, [id]);
  const logs = await query(
    `select agent, action, level, message, reasoning, created_at from agent_logs
      where opportunity_id=$1 order by created_at desc limit 50`,
    [id]
  );
  return { opp, bid, quotes, subs, documents, logs };
}

export async function pricingSummaryFor(opp: Opportunity): Promise<Record<string, unknown> | null> {
  const raw = opp.raw_json as { pricing_summary?: Record<string, unknown> } | null;
  return raw?.pricing_summary ?? null;
}
