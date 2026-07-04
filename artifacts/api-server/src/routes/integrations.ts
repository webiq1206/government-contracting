import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";

const router = Router();
router.use(requireAuth);

function bool(key: string): boolean {
  const v = process.env[key];
  return v != null && v !== "";
}

router.get("/status", (_req: Request, res: Response) => {
  const hasRedis = bool("REDIS_URL");
  res.json({
    database: bool("DATABASE_URL"),
    claude: bool("ANTHROPIC_API_KEY"),
    sam: bool("SAM_API_KEY"),
    usaspending: true,
    bls: true,
    googleMaps: bool("GOOGLE_MAPS_API_KEY"),
    hunter: bool("HUNTER_API_KEY"),
    gmail: bool("GMAIL_REFRESH_TOKEN"),
    twilio: bool("TWILIO_ACCOUNT_SID") && bool("TWILIO_AUTH_TOKEN"),
    resend: bool("RESEND_API_KEY"),
    supabaseStorage: bool("SUPABASE_URL") && bool("SUPABASE_SERVICE_ROLE_KEY"),
    queue: hasRedis ? "bullmq" : "pgboss",
  });
});

export default router;
