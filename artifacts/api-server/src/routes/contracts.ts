import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query } from "../lib/db";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  const rows = await query(`
    select c.*,
           o.title as opportunity_title,
           o.agency,
           ps.company_name as primary_sub_name,
           bs.company_name as backup_sub_name
      from contracts c
      left join opportunities o on o.id = c.opportunity_id
      left join subcontractors ps on ps.id = c.primary_sub_id
      left join subcontractors bs on bs.id = c.backup_sub_id
     where c.status = 'active'
     order by c.created_at desc
  `);
  res.json(rows);
});

export default router;
