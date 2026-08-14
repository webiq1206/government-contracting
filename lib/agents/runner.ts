/**
 * Agent runner. Wraps every agent execution with: a job_runs audit row, an
 * agent_logs entry (success or error), downstream job enqueueing, the tenant
 * context the job belongs to, and total isolation, a thrown error is logged
 * and swallowed so it never cascades.
 */
import { randomUUID } from "node:crypto";
import { claudeEnabled } from "../ai/claude";
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { enqueue } from "../queue";
import { config } from "../config";
import { runWithOrg } from "../tenant-context";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

/**
 * How a job payload names the organization it belongs to.
 *
 * A queue job carries a payload and nothing else: no session, no tenant. So
 * every agent that asked who the tenant was got the same answer, the founding
 * org, and scored, priced, wrote and billed each customer's work as us. Fixing
 * that one agent at a time means the next agent someone writes has to remember
 * to do it, and there is nothing to remind them. Resolving it here means the
 * default is right and an agent has to opt out rather than opt in.
 *
 * Each entry is a full statement rather than a table name spliced into one, so
 * this list cannot become a place where a string reaches SQL. To support a new
 * payload key, add its lookup here.
 */
const ORG_OF_PAYLOAD: { key: string; sql: string }[] = [
  // Order is priority. The opportunity is what the work is about, so when a
  // payload names several records it decides.
  { key: "opportunityId", sql: `select org_id from opportunities where id = $1` },
  { key: "subcontractorId", sql: `select org_id from subcontractors where id = $1` },
];

/**
 * The organization this job belongs to, or null when the payload names no
 * record.
 *
 * Null means leave the context alone rather than guess. A cron sweep has no
 * payload and does its own per-organization loop; a manual run from the UI
 * already resolves the signed-in user's org. Substituting a default here would
 * quietly overrule both.
 */
async function payloadOrgId(
  agentName: string,
  payload: Record<string, unknown>
): Promise<string | null> {
  let resolved = typeof payload.orgId === "string" && payload.orgId ? payload.orgId : null;

  for (const { key, sql } of ORG_OF_PAYLOAD) {
    const id = payload[key];
    if (typeof id !== "string" || !id) continue;
    // A malformed id is not a uuid and the lookup throws. That is the agent's
    // problem to report, not the runner's; it just means no context.
    const row = await queryOne<{ org_id: string | null }>(sql, [id]).catch(() => null);
    const orgId = row?.org_id ?? null;
    if (!orgId) continue;
    if (!resolved) {
      resolved = orgId;
      continue;
    }
    if (resolved !== orgId) {
      /**
       * Two records in one payload owned by different organizations. The job
       * runs under the first, because refusing would strand it in the queue's
       * retry loop, but this is always a symptom: something upstream paired
       * one tenant's record with another's. It is logged at error level so it
       * lands on the Automation Log instead of passing unremarked.
       */
      await logAgent({
        agent: agentName,
        action: "payload-org-mismatch",
        level: "error",
        status: "error",
        opportunityId: (payload.opportunityId as string) ?? null,
        subcontractorId: (payload.subcontractorId as string) ?? null,
        message:
          `Job payload names records from two organizations (${resolved} and ${orgId} via ${key}). ` +
          `Running as ${resolved}. Something upstream paired one organization's record with another's.`,
      });
    }
  }

  return resolved;
}

export async function runAgent(
  def: AgentDefinition,
  trigger: "cron" | "queue" | "manual",
  payload: Record<string, unknown> = {}
): Promise<AgentResult> {
  if (config.worker.disabledAgents.includes(def.name)) {
    return { ok: true, summary: `${def.name} is disabled via DISABLED_AGENTS` };
  }

  const { isAutomationPaused } = await import("../app-settings");
  if (await isAutomationPaused()) {
    return {
      ok: true,
      summary: `${def.name} skipped: automation is fully paused`,
    };
  }

  /**
   * Everything from here down runs as the organization the job belongs to.
   *
   * The pause check above is deliberately outside it: that switch is read at
   * the platform level for a queue job today and stopping every tenant is what
   * an operator reaching for it expects. Wrapping it would turn a global kill
   * switch into a per-customer one, which is a decision, not a bug fix.
   */
  const orgId = await payloadOrgId(def.name, payload);
  const inOrg = <T>(fn: () => Promise<T>): Promise<T> =>
    orgId === null ? fn() : runWithOrg(orgId, fn);

  const runId = randomUUID();
  const started = Date.now();
  const jobRun = await queryOne<{ id: string }>(
    `insert into job_runs (agent, trigger, status) values ($1,$2,'running') returning id`,
    [def.name, trigger]
  ).catch(() => null);

  try {
    if (!(await claudeEnabled()) && !def.worksWithoutClaude) {
      const result: AgentResult = {
        ok: true,
        summary: `${def.name} skipped: ANTHROPIC_API_KEY not set`,
      };
      await inOrg(() =>
        logAgent({
          agent: def.name,
          action: "run",
          level: "warn",
          status: "skipped",
          message: result.summary,
          opportunityId: (payload.opportunityId as string) ?? null,
        })
      );
      await finishJobRun(jobRun?.id, "ok", result, Date.now() - started);
      return result;
    }

    const result = await inOrg(() => def.handler({ runId, trigger, payload }));

    await inOrg(() =>
      logAgent({
        agent: def.name,
        action: "run",
        level: result.ok ? "success" : "warn",
        status: result.ok ? "ok" : "error",
        message: result.summary,
        reasoning: result.reasoning,
        opportunityId: (payload.opportunityId as string) ?? null,
        output: result.data,
        durationMs: Date.now() - started,
      })
    );

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
    await inOrg(() =>
      logAgent({
        agent: def.name,
        action: "run",
        level: "error",
        status: "error",
        message,
        opportunityId: (payload.opportunityId as string) ?? null,
      })
    );
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
