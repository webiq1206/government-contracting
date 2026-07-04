import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  const profile = await queryOne<Record<string, unknown>>(
    `select * from company_profile where is_active = true order by updated_at desc limit 1`
  );
  res.json({ profile });
});

router.post("/", async (req: Request, res: Response) => {
  const { profile_json } = req.body ?? {};
  if (!profile_json || typeof profile_json !== "object") {
    res.status(400).json({ error: "Invalid profile JSON." });
    return;
  }
  if (!profile_json.legal_name) {
    res.status(400).json({ error: "legal_name is required." });
    return;
  }

  await query(`update company_profile set is_active=false where is_active=true`);
  const versionRow = await queryOne<{ max_ver: string }>(`select coalesce(max(version),0) as max_ver from company_profile`);
  const newVersion = Number(versionRow?.max_ver ?? 0) + 1;

  const profileText = JSON.stringify(profile_json, null, 2);
  await query(
    `insert into company_profile (version, is_active, profile_json, profile_text, updated_by) values ($1, true, $2, $3, $4)`,
    [newVersion, JSON.stringify(profile_json), profileText, req.sessionUser?.email ?? "operator"]
  );
  res.json({ ok: true, version: newVersion });
});

export default router;
