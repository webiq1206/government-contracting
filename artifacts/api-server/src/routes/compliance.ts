import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query } from "../lib/db";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  const rows = await query(
    `select * from compliance_items order by
      case status when 'blocked' then 0 when 'critical' then 1 when 'warning' then 2 else 3 end,
      due_at asc nulls last`
  );
  res.json(rows);
});

export default router;
