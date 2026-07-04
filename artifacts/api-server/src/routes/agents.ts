import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query } from "../lib/db";
import { ROSTER, MAINTENANCE, getAgent, scheduledAgents } from "../engine/agents/registry";
import { enqueue } from "../engine/queue";

const router = Router();
router.use(requireAuth);

/** Serialize the real agent roster (13 agents + maintenance) with live cron schedules. */
function roster() {
  const cronByName = new Map(scheduledAgents().map((s) => [s.agent.name, s.cron]));
  return [...ROSTER, ...MAINTENANCE].map((a) => ({
    name: a.name,
    label: a.label,
    description: a.description,
    cron: a.cron ?? cronByName.get(a.name) ?? null,
    works_without_claude: Boolean(a.worksWithoutClaude),
  }));
}

router.get("/", async (_req: Request, res: Response) => {
  const jobRuns = await query<Record<string, unknown>>(
    `select agent, trigger, status, started_at, finished_at, error, summary
       from job_runs order by started_at desc limit 50`
  );
  res.json({ roster: roster(), job_runs: jobRuns });
});

router.get("/logs", async (req: Request, res: Response) => {
  const { agent, limit } = req.query;
  const params: unknown[] = [];
  const where: string[] = [];
  if (agent) {
    params.push(agent);
    where.push(`agent = $${params.length}`);
  }
  const lim = Math.min(Number(limit ?? 150), 500);
  const rows = await query(
    `select * from agent_logs ${where.length ? "where " + where.join(" and ") : ""} order by created_at desc limit ${lim}`,
    params
  );
  res.json(rows);
});

/** Manually trigger an agent — enqueues a real job the engine worker executes. */
router.post("/:name/run", async (req: Request, res: Response) => {
  const { name } = req.params;
  const def = getAgent(name);
  if (!def) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const payload = { ...(req.body ?? {}), trigger: "manual" };
  try {
    const jobId = await enqueue(def.name, payload);
    res.json({ ok: true, agent: def.name, job_id: jobId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
