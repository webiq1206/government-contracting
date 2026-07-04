import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";

const router = Router();
router.use(requireAuth);

router.get("/kpis", async (_req: Request, res: Response) => {
  const snap = await queryOne<Record<string, unknown>>(
    `select * from kpi_snapshots order by created_at desc limit 1`
  );

  const live = await queryOne<{
    total_bids: string;
    total_won: string;
    pipeline_value: string;
    active_revenue: string;
    total_subs: string;
    active_opps: string;
  }>(`select
    (select count(*) from bids where outcome is not null and outcome <> 'pending') as total_bids,
    (select count(*) from bids where outcome='won') as total_won,
    (select coalesce(sum(value_estimated),0) from opportunities where stage not in ('dismissed','lost','won') and status='open') as pipeline_value,
    (select coalesce(sum(award_amount),0) from contracts where status='active') as active_revenue,
    (select count(*) from subcontractors where blacklisted=false) as total_subs,
    (select count(*) from opportunities where status='open' and stage not in ('dismissed','won','lost')) as active_opps
  `);

  const totalBids = Number(live?.total_bids ?? 0);
  const totalWon = Number(live?.total_won ?? 0);
  const winRate = totalBids > 0 ? Math.round((totalWon / totalBids) * 100) : null;

  res.json({
    win_rate: snap ? snap.win_rate ?? winRate : winRate,
    avg_margin_on_wins: snap?.avg_margin_on_wins ?? null,
    pipeline_value: snap?.pipeline_value ?? Number(live?.pipeline_value ?? 0),
    active_contract_revenue: snap?.active_contract_revenue ?? Number(live?.active_revenue ?? 0),
    total_bids: totalBids,
    total_won: totalWon,
    total_subs: Number(live?.total_subs ?? 0),
    active_opportunities: Number(live?.active_opps ?? 0),
    by_naics: snap?.by_naics ?? [],
    by_agency: snap?.by_agency ?? [],
    by_state: snap?.by_state ?? [],
    top_subs: snap?.top_subs ?? [],
  });
});

router.get("/pipeline-summary", async (_req: Request, res: Response) => {
  const byStage = await query<{ stage: string; cnt: string }>(
    `select stage, count(*) as cnt from opportunities where status='open' group by stage`
  );
  const byTier = await query<{ tier: string; cnt: string }>(
    `select tier, count(*) as cnt from opportunities where status='open' and tier is not null group by tier`
  );
  const actionRow = await queryOne<{ cnt: string }>(
    `select count(*) as cnt from opportunities where human_action_required=true and status='open'`
  );
  res.json({
    by_stage: byStage.map((r) => ({ stage: r.stage, count: Number(r.cnt) })),
    by_tier: byTier.map((r) => ({ tier: r.tier, count: Number(r.cnt) })),
    human_action_count: Number(actionRow?.cnt ?? 0),
  });
});

export default router;
