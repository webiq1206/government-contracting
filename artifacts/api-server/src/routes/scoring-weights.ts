import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  const rows = await query(
    `select id, version, rationale, proposed_at, weights from scoring_weights
      where approved_at is null and proposed_by = 'learning-loop'
      order by proposed_at desc`
  );
  res.json(rows);
});

router.post("/:id/approve", async (req: Request, res: Response) => {
  const { id } = req.params;
  const row = await queryOne<{ id: string; weights: unknown }>(
    `select id, weights from scoring_weights where id=$1 and approved_at is null`,
    [id]
  );
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  await query(`update scoring_weights set is_active=false where is_active=true`);
  await query(
    `update scoring_weights set approved_at=now(), approved_by=$1, is_active=true where id=$2`,
    [req.sessionUser?.email ?? "operator", id]
  );
  res.json({ ok: true });
});

export default router;
