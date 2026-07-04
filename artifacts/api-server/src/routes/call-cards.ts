import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  const rows = await query(`
    select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.card_json, cc.call_script,
           cc.question_list, cc.needs_project_history, cc.status,
           s.company_name, s.phone,
           o.title as opportunity_title, o.deadline,
           (select trade_categories[1] from subcontractors where id=cc.subcontractor_id limit 1) as trade
      from call_cards cc
      join subcontractors s on s.id = cc.subcontractor_id
      join opportunities o on o.id = cc.opportunity_id
     where cc.status='pending'
     order by (o.deadline is null), o.deadline asc
  `);
  // Normalize question_list from jsonb
  const normalized = rows.map((r: Record<string, unknown>) => ({
    ...r,
    question_list: Array.isArray(r.question_list) ? r.question_list : null,
  }));
  res.json(normalized);
});

router.post("/:id/log", async (req: Request, res: Response) => {
  const { outcome, notes, quote_amount, project_history } = req.body ?? {};
  const { id } = req.params;

  const card = await queryOne<{ subcontractor_id: string; opportunity_id: string }>(
    `select subcontractor_id, opportunity_id from call_cards where id=$1`,
    [id]
  );
  if (!card) { res.status(404).json({ error: "Not found" }); return; }

  await query(
    `update call_cards set status='called', called_at=now(), response_json=$1 where id=$2`,
    [JSON.stringify({ outcome, notes, quote_amount }), id]
  );

  if (project_history && Array.isArray(project_history)) {
    await query(
      `update subcontractors set project_history=$1, updated_at=now() where id=$2`,
      [JSON.stringify(project_history), card.subcontractor_id]
    );
  }

  if (notes) {
    await query(
      `insert into communications (subcontractor_id, opportunity_id, channel, direction, body)
       values ($1, $2, 'call', 'inbound', $3)`,
      [card.subcontractor_id, card.opportunity_id, notes]
    );
  }

  res.json({ ok: true });
});

export default router;
