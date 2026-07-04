import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";

const router = Router();
router.use(requireAuth);

const STANDARD_QUESTIONS = [
  "Can you perform this scope of work?",
  "Are you interested in bidding this project?",
  "If yes, what is your estimated price or when can you provide a bid?",
  "Do you have any questions about the scope?",
  "When can you start if awarded the job?",
];

router.get("/", async (_req: Request, res: Response) => {
  const rows = await query(`
    select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.card_json, cc.call_script,
           cc.question_list, cc.needs_project_history, cc.status, cc.quote_amount,
           s.company_name, s.phone, s.email, s.last_contacted,
           o.title as opportunity_title, o.deadline, o.location_text, o.location_state,
           o.description as scope, o.stage as bid_status,
           (select trade_categories[1] from subcontractors where id=cc.subcontractor_id limit 1) as trade,
           (select quote_amount from call_cards
             where subcontractor_id=cc.subcontractor_id
               and opportunity_id=cc.opportunity_id
               and status='called'
               and quote_amount is not null
             order by called_at desc limit 1) as prior_quote_amount
      from call_cards cc
      join subcontractors s on s.id = cc.subcontractor_id
      join opportunities o on o.id = cc.opportunity_id
     where cc.status='pending'
     order by (o.deadline is null), o.deadline asc
  `);

  const normalized = rows.map((r: Record<string, unknown>) => {
    const existingQs = Array.isArray(r.question_list) ? r.question_list as string[] : [];
    const mergedQs = existingQs.length > 0
      ? [...new Set([...existingQs, ...STANDARD_QUESTIONS])]
      : STANDARD_QUESTIONS;
    return {
      ...r,
      question_list: mergedQs,
    };
  });
  res.json(normalized);
});

router.patch("/:id", async (req: Request, res: Response) => {
  const { quote_amount } = req.body ?? {};
  if (quote_amount === undefined) {
    res.status(400).json({ error: "quote_amount is required" });
    return;
  }
  const { id } = req.params;
  await query(
    `update call_cards set quote_amount=$1 where id=$2`,
    [quote_amount === null ? null : Number(quote_amount), id]
  );
  res.json({ ok: true });
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
    `update call_cards
        set status='called', called_at=now(),
            response_json=$1,
            quote_amount=coalesce($2, quote_amount)
      where id=$3`,
    [JSON.stringify({ outcome, notes, quote_amount }), quote_amount != null ? Number(quote_amount) : null, id]
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
