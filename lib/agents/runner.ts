/**
 * Agent runner. Wraps every agent execution with: a job_runs audit row, an
 * agent_logs entry (success or error), downstream job enqueueing, and total
 * isolation — a thrown error is logged and swallowed so it never cascades.
 */
import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { enqueue } from "../queue";
import { config } from "../config";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

export async function runAgent(
  def: AgentDefinition,
  trigger: "cron" | "queue" | "manual",
  payload: Record<string, unknown> = {}
): Promise<AgentResult> {
  if (config.worker.disabledAgents.includes(def.name)) {
    return { ok: true, summary: `${def.name} is disabled via DISABLED_AGENTS` };
  }

  const runId = randomUUID();
  const started = Date.now();
  const jobRun = await queryOne<{ id: string }>(
    `insert into job_runs (agent, trigger, status) values ($1,$2,'running') returning id`,
    [def.name, trigger]
  ).catch(() => null);

  try {
    if (!config.claude.enabled && !def.worksWithoutClaude) {
      const result: AgentResult = {
        ok: true,
        summary: `${def.name} skipped: ANTHROPIC_API_KEY not set`,
      };
      await logAgent({
        agent: def.name,
        action: "run",
        level: "warn",
        status: "skipped",
        message: result.summary,
        opportunityId: (payload.opportunityId as string) ?? null,
      });
      await finishJobRun(jobRun?.id, "ok", result, Date.now() - started);
      return result;
    }

    const result = await def.handler({ runId, trigger, payload });

    await logAgent({
      agent: def.name,
      action: "run",
      level: result.ok ? "success" : "warn",
      status: result.ok ? "ok" : "error",
      message: result.summary,
      reasoning: result.reasoning,
      opportunityId: (payload.opportunityId as string) ?? null,
      output: result.data,
      durationMs: Date.now() - started,
    });

    // Enqueue downstream work declared by the agent.
    for (const next of result.enqueued ?? []) {
      await enqueue(next.agent, next.payload, next.opts).catch((e) =>
        console.error(`[runner] enqueue ${next.agent} failed:`, (e as Error).message)
      );
    }

    await finishJobRun(jobRun?.id, "ok", result, Date.now() - started);
    return result;
  } catch (err) {
    const message = (err as Error).message;
    await logAgent({
      agent: def.name,
      action: "run",
      level: "error",
      status: "error",
      message,
      opportunityId: (payload.opportunityId as string) ?? null,
    });
    await finishJobRun(
      jobRun?.id,
      "error",
      { ok: false, summary: message },
      Date.now() - started,
      message
    );
    // Isolation: do not rethrow. One agent's failure must not cascade.
    return { ok: false, summary: message };
  }
}

async function finishJobRun(
  id: string | undefined,
  status: "ok" | "error",
  result: AgentResult,
  _durationMs: number,
  error?: string
) {
  if (!id) return;
  await query(
    `update job_runs set status=$2, finished_at=now(), error=$3, summary=$4 where id=$1`,
    [id, status, error ?? null, JSON.stringify({ summary: result.summary, data: result.data })]
  ).catch(() => {});
}
