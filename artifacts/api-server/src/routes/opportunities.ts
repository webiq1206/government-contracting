import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  const { stage, tier, human_action_required, limit } = req.query;
  const where: string[] = ["stage <> 'dismissed'", "status <> 'archived'"];
  const params: unknown[] = [];

  if (stage) { params.push(stage); where.push(`stage = $${params.length}`); }
  if (tier) { params.push(tier); where.push(`tier = $${params.length}`); }
  if (human_action_required === "true") where.push("human_action_required = true");

  const lim = Math.min(Number(limit ?? 500), 1000);
  const rows = await query(
    `select * from opportunities where ${where.join(" and ")} order by (deadline is null), deadline asc limit ${lim}`,
    params
  );
  res.json(rows);
});

router.get("/:id", async (req: Request, res: Response) => {
  const row = await queryOne(`select * from opportunities where id = $1`, [req.params.id]);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const bidSummary = await queryOne<{
    quote_count: string;
    min_quote: string | null;
    max_quote: string | null;
    avg_quote: string | null;
  }>(
    `select count(quote_amount)::text as quote_count,
            min(quote_amount)::text as min_quote,
            max(quote_amount)::text as max_quote,
            round(avg(quote_amount))::text as avg_quote
       from call_cards
      where opportunity_id = $1 and quote_amount is not null`,
    [req.params.id]
  );

  res.json({
    ...(row as Record<string, unknown>),
    bid_quote_count: Number(bidSummary?.quote_count ?? 0),
    bid_min_quote: bidSummary?.min_quote != null ? Number(bidSummary.min_quote) : null,
    bid_max_quote: bidSummary?.max_quote != null ? Number(bidSummary.max_quote) : null,
    bid_avg_quote: bidSummary?.avg_quote != null ? Number(bidSummary.avg_quote) : null,
  });
});

router.get("/:id/quotes", async (req: Request, res: Response) => {
  const rows = await query(
    `select cc.id as card_id, cc.subcontractor_id, cc.quote_amount, cc.status,
            cc.called_at, cc.response_json,
            s.company_name, s.phone, s.email, s.trade_categories
       from call_cards cc
       join subcontractors s on s.id = cc.subcontractor_id
      where cc.opportunity_id = $1
      order by cc.quote_amount asc nulls last, cc.called_at desc`,
    [req.params.id]
  );
  res.json(rows);
});

router.post("/:id/action", async (req: Request, res: Response) => {
  const { action, stage } = req.body ?? {};
  const { id } = req.params;

  if (action === "pursue") {
    await query(
      `update opportunities set tier='pursue', stage='analysis', human_action_required=false, updated_at=now() where id=$1`,
      [id]
    );
  } else if (action === "dismiss") {
    await query(
      `update opportunities set tier='dismiss', stage='dismissed', human_action_required=false, updated_at=now() where id=$1`,
      [id]
    );
  } else if (action === "advance" && stage) {
    await query(
      `update opportunities set stage=$1, human_action_required=false, updated_at=now() where id=$2`,
      [stage, id]
    );
  } else {
    res.status(400).json({ error: "Invalid action" });
    return;
  }
  res.json({ ok: true });
});

export default router;
