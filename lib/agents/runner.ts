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
import { enqueue, ENQUEUED_BY_ORG_KEY } from "../queue";
import { config } from "../config";
import { runWithOrg } from "../tenant-context";
import {
  isPermanentlyGone,
  lookupPayloadRecords,
  type PayloadRecord,
} from "./payload-records";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

/**
 * The organization this job belongs to, and any record it can no longer work
 * on.
 *
 * A queue job carries a payload and nothing else: no session, no tenant. So
 * every agent that asked who the tenant was got the same answer, the founding
 * org, and scored, priced, wrote and billed each customer's work as us. Fixing
 * that one agent at a time means the next agent someone writes has to remember
 * to do it, and there is nothing to remind them. Resolving it here means the
 * default is right and an agent has to opt out rather than opt in.
 *
 * A null org means leave the context alone rather than guess. A cron sweep has
 * no payload and does its own per-organization loop; a manual run from the UI
 * already resolves the signed-in user's org. Substituting a default here would
 * quietly overrule both.
 *
 * The same lookup is how we learn a record still exists. A record that is gone
 * or was never a valid id is permanent, and the job is abandoned rather than
 * retried. A lookup the database could not answer is ambiguous, and the safe
 * reading of ambiguity is to let the job run and fail on its own terms.
 */
async function payloadOrgId(
  agentName: string,
  payload: Record<string, unknown>
): Promise<{ orgId: string | null; missing: PayloadRecord[] }> {
  let resolved = typeof payload.orgId === "string" && payload.orgId ? payload.orgId : null;
  const records = await lookupPayloadRecords(payload);
  const missing = records.filter(isPermanentlyGone);

  for (const { key, orgId } of records) {
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

  /**
   * Nothing named an organization, so fall back to whoever queued the work.
   *
   * This is the deleted-record case above all: once the opportunity is gone
   * there is no record left to ask, and without this the line explaining the
   * abandonment would be filed against no organization, which is the same as
   * not showing it to the operator at all. A record always wins over this,
   * because the record is what the work is about.
   */
  if (!resolved) {
    const queuedBy = payload[ENQUEUED_BY_ORG_KEY];
    if (typeof queuedBy === "string" && queuedBy) resolved = queuedBy;
  }

  return { orgId: resolved, missing };
}

/**
 * Whether the queue should retry after this result.
 *
 * The queue's rethrow lives in the worker, but the rule belongs next to the
 * runner that produces the result, where it can be read against the isolation
 * comment above it and tested on its own.
 */
export function shouldQueueRetry(result: AgentResult): boolean {
  return !result.ok && !result.permanent;
}

/** Plain sentence naming the records a job can no longer work on. */
function describeMissing(missing: PayloadRecord[]): string {
  return missing
    .map((m) =>
      m.state === "malformed"
        ? `the ${m.label} id "${m.id}" is not a valid id`
        : `the ${m.label} it was for no longer exists (${m.id})`
    )
    .join(", and ");
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
  const { orgId, missing } = await payloadOrgId(def.name, payload);
  const inOrg = <T>(fn: () => Promise<T>): Promise<T> =>
    orgId === null ? fn() : runWithOrg(orgId, fn);

  const runId = randomUUID();
  const started = Date.now();
  const jobRun = await queryOne<{ id: string }>(
    `insert into job_runs (agent, trigger, status) values ($1,$2,'running') returning id`,
    [def.name, trigger]
  ).catch(() => null);

  /**
   * The record this job was about is gone, so stop here.
   *
   * Opportunities are deleted routinely, by the expiry sweep and by hand, and
   * anything already queued against one outlives it. Left alone, the agent
   * reports "not found", the worker reads that as a failure worth retrying,
   * and the same dead record is worked three times with backoff before the
   * queue gives up. The operator sees churn and no explanation.
   *
   * Deciding it here rather than in each agent means the ten or so agents that
   * open with a "not found" guard all get the same behaviour, and the next
   * agent someone writes gets it without having to know to ask.
   *
   * It runs after the job_runs row is opened so the abandonment is recorded in
   * the same place as every other outcome, rather than being the one result
   * that leaves no trace.
   */
  if (missing.length > 0) {
    const summary = `${def.name} abandoned: ${describeMissing(missing)}. Nothing to do, so it was not retried.`;
    await inOrg(() =>
      logAgent({
        agent: def.name,
        action: "abandoned",
        level: "warn",
        status: "skipped",
        message: summary,
        // Deliberately not carrying the ids into the reference columns: they
        // point at rows that are gone. They are named in the message instead.
        input: payload,
      })
    );
    await finishJobRun(jobRun?.id, "error", { ok: false, summary }, Date.now() - started, summary);
    return { ok: false, permanent: true, summary };
  }

  try {
    // Inside the org, like everything else that reads a credential. Outside
    // it, claudeEnabled() resolved to the founding organization: a tenant with
    // their own key had every AI agent skipped as "not set" whenever the
    // founding org had none, and a tenant with no key was let through on
    // somebody else's.
    if (!(await inOrg(() => claudeEnabled())) && !def.worksWithoutClaude) {
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

    // Enqueue downstream work declared by the agent. The org is passed in
    // rather than inherited from the context, because this loop deliberately
    // runs outside it: enqueue() reads the automation pause switch, which is
    // per organization, and wrapping the loop would change whose switch that
    // check reads. An agent that names an org itself keeps it.
    for (const next of result.enqueued ?? []) {
      await enqueue(next.agent, next.payload, {
        ...next.opts,
        ...(orgId ? { orgId } : {}),
      }).catch((e) =>
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
