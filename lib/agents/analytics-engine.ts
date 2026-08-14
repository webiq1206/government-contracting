/**
 * ANALYTICS ENGINE, daily cron (07:00). Computes the platform KPIs (win rates,
 * margins, pipeline value, contract revenue, pipeline velocity, sub rankings,
 * and a 30/60/90-day cash-flow projection) with pure SQL + math, then persists
 * the whole snapshot as an agent_logs 'kpi-snapshot' row the dashboard reads.
 *
 * Rule-only (worksWithoutClaude:true). On Mondays, emails a weekly digest.
 */
import { query, queryOne } from "../db";
import { listActiveOrganizations } from "../organizations";
import { runWithOrg, LEGACY_ORG_ID } from "../tenant-context";
import { logAgent } from "../logger";
import { systemMail } from "../integrations/system-mail";
import { config } from "../config";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

interface RateRow {
  key: string | null;
  won: string | number;
  lost: string | number;
}

interface MilestoneRow {
  award_amount: string | number | null;
  start_date: string | null;
  end_date: string | null;
  milestones: Array<{ name?: string; due?: string; amount?: number | string; status?: string }> | null;
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function rate(won: number, lost: number): number {
  const total = won + lost;
  return total === 0 ? 0 : Math.round((won / total) * 1000) / 10; // one decimal %
}

export const analyticsEngine: AgentDefinition = {
  name: "analytics-engine",
  label: "Analytics Engine",
  description:
    "Daily KPI snapshot: win rates, margins, pipeline value, revenue, velocity, sub rankings, cash-flow projection.",
  cron: "0 7 * * *",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    /**
     * One snapshot per organization.
     *
     * Every query here used to run unscoped, so a single snapshot mixed every
     * tenant's bids, contracts, and pipeline into one set of numbers, and the
     * subcontractor rankings carried other customers' company names. It was
     * then stored without an org, which the dashboard reads by, so after the
     * read path was scoped the snapshot became unreadable and the analytics
     * breakdowns sat empty for everyone. Same shape as the opportunity
     * monitor: resolve the organizations, then do the work inside each.
     */
    let orgs = await listActiveOrganizations().catch(() => []);
    if (orgs.length === 0) {
      orgs = [{ id: LEGACY_ORG_ID } as Awaited<ReturnType<typeof listActiveOrganizations>>[number]];
    }

    const summaries: string[] = [];
    for (const org of orgs) {
      summaries.push(await runWithOrg(org.id, () => computeForOrg(org.id)));
    }

    return {
      ok: true,
      summary:
        orgs.length === 1
          ? summaries[0]
          : `Snapshots for ${orgs.length} organizations. ${summaries.join(" | ")}`,
      reasoning:
        "Computed per organization from that organization's bids, opportunities, contracts, and subcontractors.",
    };
  },
};

/** Build and store one organization's KPI snapshot. Returns a one-line summary. */
async function computeForOrg(orgId: string): Promise<string> {
    // --- Win rate overall + by dimension. ---
    const overall = await queryOne<{ won: string | number; lost: string | number }>(
      `select count(*) filter (where outcome='won') as won,
              count(*) filter (where outcome='lost') as lost
         from bids where org_id = $1`,
      [orgId]
    );
    const wonCount = n(overall?.won);
    const lostCount = n(overall?.lost);

    const byNaics = await query<RateRow>(
      `select o.naics_code as key,
              count(*) filter (where b.outcome='won') as won,
              count(*) filter (where b.outcome='lost') as lost
         from bids b join opportunities o on o.id=b.opportunity_id
        where b.outcome in ('won','lost') and b.org_id = $1
        group by o.naics_code`,
      [orgId]
    );
    const byAgency = await query<RateRow>(
      `select o.agency as key,
              count(*) filter (where b.outcome='won') as won,
              count(*) filter (where b.outcome='lost') as lost
         from bids b join opportunities o on o.id=b.opportunity_id
        where b.outcome in ('won','lost') and b.org_id = $1
        group by o.agency`,
      [orgId]
    );
    const byGeo = await query<RateRow>(
      `select o.location_state as key,
              count(*) filter (where b.outcome='won') as won,
              count(*) filter (where b.outcome='lost') as lost
         from bids b join opportunities o on o.id=b.opportunity_id
        where b.outcome in ('won','lost') and b.org_id = $1
        group by o.location_state`,
      [orgId]
    );

    const mapRates = (rows: RateRow[]) =>
      rows.map((r) => ({
        key: r.key ?? "(unknown)",
        won: n(r.won),
        lost: n(r.lost),
        win_rate: rate(n(r.won), n(r.lost)),
      }));

    // --- Avg margin on wins. ---
    const marginRow = await queryOne<{ avg: string | number | null }>(
      `select avg(margin_pct) as avg from bids where outcome='won' and org_id = $1`,
      [orgId]
    );
    const avgMarginOnWins = Math.round(n(marginRow?.avg) * 10) / 10;

    // --- Pipeline value (open, not dismissed/lost). ---
    const pipelineRow = await queryOne<{ total: string | number | null }>(
      `select coalesce(sum(value_estimated),0) as total
         from opportunities
        where status='open' and stage not in ('dismissed','lost') and org_id = $1`,
      [orgId]
    );
    const pipelineValue = n(pipelineRow?.total);

    // --- Revenue from active contracts. ---
    const revenueRow = await queryOne<{ total: string | number | null }>(
      `select coalesce(sum(award_amount),0) as total from contracts
        where status='active' and org_id = $1`,
      [orgId]
    );
    const activeContractRevenue = n(revenueRow?.total);

    // --- Pipeline velocity: count per stage (labeled as counts). ---
    const stageRows = await query<{ stage: string; count: string | number }>(
      `select stage, count(*) as count from opportunities
        where org_id = $1 group by stage`,
      [orgId]
    );
    const pipelineByStage = stageRows.map((r) => ({ stage: r.stage, count: n(r.count) }));

    // --- Sub reliability rankings (top 10). ---
    const subRows = await query<{
      id: string;
      company_name: string;
      reliability_score: number | null;
      responsiveness_score: number | null;
      is_preferred: boolean;
    }>(
      `select id, company_name, reliability_score, responsiveness_score, is_preferred
         from subcontractors
        where reliability_score is not null and blacklisted = false
          and org_id = $1
        order by reliability_score desc nulls last
        limit 10`,
      [orgId]
    );
    const subRankings = subRows.map((s) => ({
      id: s.id,
      company_name: s.company_name,
      reliability_score: s.reliability_score,
      responsiveness_score: s.responsiveness_score,
      is_preferred: s.is_preferred,
    }));

    // --- 30/60/90-day cash-flow projection from contract milestones. ---
    const contractRows = await query<MilestoneRow>(
      `select award_amount, start_date, end_date, milestones
         from contracts where status='active' and org_id = $1`,
      [orgId]
    );
    const cashFlow = projectCashFlow(contractRows);

    const kpis = {
      generated_at: new Date().toISOString(),
      win_rate: {
        overall: rate(wonCount, lostCount),
        won: wonCount,
        lost: lostCount,
        by_naics: mapRates(byNaics),
        by_agency: mapRates(byAgency),
        by_geography: mapRates(byGeo),
      },
      avg_margin_on_wins_pct: avgMarginOnWins,
      pipeline_value: pipelineValue,
      active_contract_revenue: activeContractRevenue,
      pipeline_velocity: { note: "counts per stage (not durations)", by_stage: pipelineByStage },
      sub_reliability_rankings: subRankings,
      cash_flow_projection: cashFlow,
    };

    // --- Persist snapshot in agent_logs (dashboard reads the latest). ---
    // The org goes on the row. agent_logs has no trigger to derive it, and the
    // dashboard reads the snapshot back scoped to the organization, so a row
    // without one is written and then never found by anybody.
    await query(
      `insert into agent_logs (org_id, agent, action, level, message, output_json)
       values ($2,'analytics-engine','kpi-snapshot','info','daily KPIs',$1)`,
      [JSON.stringify(kpis), orgId]
    );

    await logAgent({
      agent: "analytics-engine",
      action: "compute-kpis",
      level: "success",
      message: `KPIs computed: ${kpis.win_rate.overall}% win rate, $${pipelineValue.toLocaleString()} pipeline.`,
      reasoning: `Win ${wonCount}/${wonCount + lostCount}; avg win margin ${avgMarginOnWins}%; active revenue $${activeContractRevenue.toLocaleString()}.`,
    });

    /**
     * The weekly digest goes to the platform's own address, so it may only
     * ever carry the platform's own numbers. Sending it for every tenant
     * would mail one customer's win rates and pipeline to us, once per
     * customer. Per-tenant digests need a per-tenant recipient, which is a
     * separate piece of work.
     */
    const isMonday = new Date().getDay() === 1;
    if (orgId === LEGACY_ORG_ID && isMonday && (await systemMail.enabled())) {
      await systemMail.sendDigest({
        to: config.systemMail.digestTo,
        subject: `BROST CO Weekly KPIs, ${kpis.win_rate.overall}% win rate`,
        html: renderDigestHtml(kpis),
        text: renderDigestText(kpis),
      });
    }

    return `${kpis.win_rate.overall}% win rate (${wonCount}W/${lostCount}L), $${pipelineValue.toLocaleString()} pipeline`;
}

interface CashFlowProjection {
  window_days: number[];
  buckets: { days: number; amount: number }[];
  basis: "milestones" | "spread" | "mixed";
}

/**
 * Sum milestone amounts due within 30/60/90 days. When a contract has no
 * milestones, approximate by spreading award_amount evenly across its
 * start..end window and attributing the portion falling in each horizon.
 */
function projectCashFlow(contracts: MilestoneRow[]): CashFlowProjection {
  const horizons = [30, 60, 90];
  const now = Date.now();
  const totals: Record<number, number> = { 30: 0, 60: 0, 90: 0 };
  let usedMilestones = false;
  let usedSpread = false;

  for (const c of contracts) {
    const milestones = Array.isArray(c.milestones) ? c.milestones : [];
    const openMilestones = milestones.filter(
      (m) => m && (m.status ?? "") !== "paid" && (m.status ?? "") !== "complete"
    );

    if (openMilestones.length > 0) {
      usedMilestones = true;
      for (const m of openMilestones) {
        if (!m.due) continue;
        const due = new Date(m.due).getTime();
        if (!Number.isFinite(due) || due < now) continue;
        const daysOut = (due - now) / 86_400_000;
        for (const h of horizons) {
          if (daysOut <= h) totals[h] += n(m.amount);
        }
      }
    } else {
      // Spread award_amount across start..end.
      const award = n(c.award_amount);
      if (award <= 0 || !c.start_date || !c.end_date) continue;
      const start = new Date(c.start_date).getTime();
      const end = new Date(c.end_date).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      usedSpread = true;
      const totalDays = (end - start) / 86_400_000;
      const perDay = award / totalDays;
      for (const h of horizons) {
        const windowStart = Math.max(start, now);
        const windowEnd = Math.min(end, now + h * 86_400_000);
        if (windowEnd > windowStart) {
          const days = (windowEnd - windowStart) / 86_400_000;
          totals[h] += perDay * days;
        }
      }
    }
  }

  const basis: CashFlowProjection["basis"] =
    usedMilestones && usedSpread ? "mixed" : usedSpread ? "spread" : "milestones";
  return {
    window_days: horizons,
    buckets: horizons.map((h) => ({ days: h, amount: Math.round(totals[h] * 100) / 100 })),
    basis,
  };
}

function usd(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function renderDigestText(k: {
  win_rate: { overall: number; won: number; lost: number };
  avg_margin_on_wins_pct: number;
  pipeline_value: number;
  active_contract_revenue: number;
  cash_flow_projection: CashFlowProjection;
}): string {
  const cf = k.cash_flow_projection.buckets
    .map((b) => `${b.days}d: ${usd(b.amount)}`)
    .join(", ");
  return [
    `BROST CO Weekly KPIs`,
    `Win rate: ${k.win_rate.overall}% (${k.win_rate.won}W/${k.win_rate.lost}L)`,
    `Avg margin on wins: ${k.avg_margin_on_wins_pct}%`,
    `Pipeline value: ${usd(k.pipeline_value)}`,
    `Active contract revenue: ${usd(k.active_contract_revenue)}`,
    `Cash-flow projection (${k.cash_flow_projection.basis}): ${cf}`,
  ].join("\n");
}

function renderDigestHtml(k: {
  win_rate: { overall: number; won: number; lost: number };
  avg_margin_on_wins_pct: number;
  pipeline_value: number;
  active_contract_revenue: number;
  cash_flow_projection: CashFlowProjection;
}): string {
  const rows = [
    ["Win rate", `${k.win_rate.overall}% (${k.win_rate.won}W/${k.win_rate.lost}L)`],
    ["Avg margin on wins", `${k.avg_margin_on_wins_pct}%`],
    ["Pipeline value", usd(k.pipeline_value)],
    ["Active contract revenue", usd(k.active_contract_revenue)],
    ...k.cash_flow_projection.buckets.map(
      (b) => [`Cash flow (${b.days}d)`, usd(b.amount)] as [string, string]
    ),
  ];
  const trs = rows
    .map(
      ([label, val]) =>
        `<tr><td style="padding:4px 12px 4px 0">${label}</td><td style="padding:4px 0;font-weight:600">${val}</td></tr>`
    )
    .join("");
  return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;color:#242424">
<h2 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;color:#242424;margin:0 0 4px">BROST CO Weekly KPIs</h2>
<div style="width:48px;height:2px;background:#B28F5D;margin:0 0 14px"></div>
<table style="border-collapse:collapse">${trs}</table>
</div>`;
}
