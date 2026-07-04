import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";

const router = Router();
router.use(requireAuth);

const ROSTER = [
  { name: "opportunity-monitor", label: "Opportunity Monitor", description: "Monitors SAM.gov and other sources for new procurement opportunities.", cron: "0 */4 * * *" },
  { name: "scoring-engine", label: "Scoring Engine", description: "Scores new opportunities against company profile using Claude.", cron: "*/15 * * * *" },
  { name: "solicitation-analyst", label: "Solicitation Analyst", description: "Analyzes solicitation documents to extract requirements and trade needs.", cron: null },
  { name: "sub-researcher", label: "Sub Researcher", description: "Finds and verifies subcontractors for opportunity trades.", cron: null },
  { name: "sub-outreach", label: "Sub Outreach", description: "Sends outreach emails to subcontractors and schedules follow-ups.", cron: null },
  { name: "call-prep", label: "Call Prep Agent", description: "Builds call cards for the call queue from verified subs.", cron: null },
  { name: "bid-builder", label: "Bid Builder", description: "Assembles bid packages from quotes and company profile.", cron: null },
  { name: "compliance-monitor", label: "Compliance Monitor", description: "Monitors SAM registration, certifications, and contract spending caps.", cron: "0 8 * * *" },
  { name: "analytics-engine", label: "Analytics Engine", description: "Computes KPI snapshots and win-rate breakdowns.", cron: "0 6 * * 1" },
  { name: "learning-loop", label: "Learning Loop", description: "Proposes scoring weight updates based on win/loss patterns.", cron: "0 2 * * 0" },
];

router.get("/", async (_req: Request, res: Response) => {
  const jobRuns = await query<Record<string, unknown>>(
    `select agent, trigger, status, started_at, finished_at, error, summary
       from job_runs order by started_at desc limit 50`
  );
  res.json({ roster: ROSTER, job_runs: jobRuns });
});

router.get("/logs", async (req: Request, res: Response) => {
  const { agent, limit } = req.query;
  const params: unknown[] = [];
  const where: string[] = [];
  if (agent) { params.push(agent); where.push(`agent = $${params.length}`); }
  const lim = Math.min(Number(limit ?? 150), 500);
  const rows = await query(
    `select * from agent_logs ${where.length ? "where " + where.join(" and ") : ""} order by created_at desc limit ${lim}`,
    params
  );
  res.json(rows);
});

router.post("/:name/run", async (req: Request, res: Response) => {
  const { name } = req.params;
  const agent = ROSTER.find((a) => a.name === name);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const runId = crypto.randomUUID();
  await query(
    `insert into job_runs (id, agent, trigger, status, started_at) values ($1, $2, 'manual', 'ok', now())`,
    [runId, name]
  );
  await query(
    `insert into agent_logs (agent, action, level, status, message) values ($1, 'manual_trigger', 'info', 'ok', $2)`,
    [name, `${agent.label} triggered manually`]
  );

  res.json({ ok: true, run_id: runId });
});

export default router;
