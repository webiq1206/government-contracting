import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  const { trade, state, q, minReliability } = req.query;
  const where: string[] = ["blacklisted = false"];
  const params: unknown[] = [];

  if (trade) { params.push(trade); where.push(`$${params.length} = any(trade_categories)`); }
  if (state) { params.push(state); where.push(`state = $${params.length}`); }
  if (minReliability) { params.push(Number(minReliability)); where.push(`reliability_score >= $${params.length}`); }
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    where.push(`(lower(company_name) like $${params.length} or lower(owner_name) like $${params.length} or lower(city) like $${params.length})`);
  }

  const rows = await query(
    `select * from subcontractors where ${where.join(" and ")} order by company_name asc limit 500`,
    params
  );
  res.json(rows);
});

router.get("/:id", async (req: Request, res: Response) => {
  const row = await queryOne(`select * from subcontractors where id = $1`, [req.params.id]);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.get("/:id/quotes", async (req: Request, res: Response) => {
  const rows = await query(
    `select cc.id as card_id, cc.quote_amount, cc.status, cc.called_at,
            cc.response_json, o.id as opportunity_id, o.title as opportunity_title,
            o.deadline, o.stage, o.value_estimated
       from call_cards cc
       join opportunities o on o.id = cc.opportunity_id
      where cc.subcontractor_id = $1
        and cc.quote_amount is not null
      order by cc.called_at desc nulls last`,
    [req.params.id]
  );
  res.json(rows);
});

router.patch("/:id", async (req: Request, res: Response) => {
  const {
    notes, is_preferred, blacklisted, project_history,
    company_name, owner_name, phone, email, website, city, state,
    extra_fields,
  } = req.body ?? {};
  const sets: string[] = ["updated_at=now()"];
  const params: unknown[] = [];

  if (notes !== undefined) { params.push(notes); sets.push(`notes=$${params.length}`); }
  if (is_preferred !== undefined) { params.push(is_preferred); sets.push(`is_preferred=$${params.length}`); }
  if (blacklisted !== undefined) { params.push(blacklisted); sets.push(`blacklisted=$${params.length}`); }
  if (project_history !== undefined) { params.push(JSON.stringify(project_history)); sets.push(`project_history=$${params.length}`); }
  if (company_name !== undefined) { params.push(company_name); sets.push(`company_name=$${params.length}`); }
  if (owner_name !== undefined) { params.push(owner_name); sets.push(`owner_name=$${params.length}`); }
  if (phone !== undefined) { params.push(phone); sets.push(`phone=$${params.length}`); }
  if (email !== undefined) { params.push(email); sets.push(`email=$${params.length}`); }
  if (website !== undefined) { params.push(website); sets.push(`website=$${params.length}`); }
  if (city !== undefined) { params.push(city); sets.push(`city=$${params.length}`); }
  if (state !== undefined) { params.push(state); sets.push(`state=$${params.length}`); }
  if (extra_fields !== undefined && typeof extra_fields === "object" && extra_fields !== null) {
    params.push(JSON.stringify(extra_fields));
    sets.push(`extra_fields = jsonb_strip_nulls(extra_fields || $${params.length}::jsonb)`);
  }

  params.push(req.params.id);
  await query(`update subcontractors set ${sets.join(", ")} where id=$${params.length}`, params);
  res.json({ ok: true });
});

export default router;
