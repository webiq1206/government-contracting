import { withApiUsageContext } from '../api-usage/context';
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
import { pursuitStatus } from "../pursuit-guard";
import {
  CLOSED_OPPORTUNITY_JOB_KEY,
  enqueue,
  ENQUEUED_BY_ORG_KEY,
  PURSUIT_VERSION_KEY,
  RECOVERY_REQUEUE_KEY,
} from "../queue";
import { config } from "../config";
import { runWithOrg } from "../tenant-context";
import { runWithPursuitVersion } from "../pursuit-job-context";
import {
  isPermanentlyGone,
  lookupPayloadRecords,
  type PayloadRecord,
} from "./payload-records";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

/**
 * The records a run is about, for the log line that describes it.
 *
 * The opportunity was carried and the subcontractor was not, on all three of
 * the runner's log calls, although the payload holds both and the mismatch log
 * a few lines down already tagged both. That is the line with the summary and
 * the reasoning on it, so `sub-verify` wrote "Verified Rivera Roofing: email
 * verified, SAM clear, license active, standards gate sam_excluded=false,
 * rating_ok=true, contact_ok=true, outreach queued" against no subcontractor
 * at all. `subActivityLogs` selects on `subcontractor_id`, so the one place an
 * operator goes to ask what happened to a subcontractor could not show the
 * sentence that answers it, while the same sentence appeared on the
 * opportunity.
 *
 * A dangling id is safe here: the logger retries without the offending column
 * when a reference no longer resolves.
 */
export function recordRefs(payload: Record<string, unknown>): {
  opportunityId: string | null;
  subcontractorId: string | null;
} {
  return {
    opportunityId: (payload.opportunityId as string) ?? null,
    subcontractorId: (payload.subcontractorId as string) ?? null,
  };
}

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
): Promise<{ orgId: string | null; missing: PayloadRecord[]; conflict: boolean }> {
  let resolved = typeof payload.orgId === "string" && payload.orgId ? payload.orgId : null;
  const records = await lookupPayloadRecords(payload);
  const missing = records.filter(isPermanentlyGone);
  let conflict = false;

  for (const { orgId } of records) {
    if (!orgId) continue;
    if (!resolved) {
      resolved = orgId;
      continue;
    }
    if (resolved !== orgId) {
      /**
       * Two records in one payload owned by different organizations. Running
       * under the first one would do work in the wrong tenant. Refusing is
       * permanent so the queue does not retry the same mixed payload.
       */
      conflict = true;
    }
  }

  if (conflict) {
    // A mixed-tenant reference cannot be inserted into either tenant's log.
    // Record the refusal under a database-proven owner without disclosing or
    // linking the other tenant's records. Never use the payload's org claim.
    const owner = records.find((record) => record.orgId)?.orgId;
    if (owner) {
      await runWithOrg(owner, () => logAgent({
        agent: agentName,
        action: "payload-org-mismatch",
        level: "error",
        status: "error",
        message:
          "Job payload names records from two organizations. Abandoned rather than run under either one. Review the upstream job that paired these records; nothing was run.",
      }));
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

  return { orgId: resolved, missing, conflict };
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

/**
 * The durable job_runs verdict for a handler result.
 *
 * A handler can return a structured failure without throwing. Agent logs used
 * that boolean correctly, but job_runs was always finished as `ok`, leaving
 * Automation Health with two opposite answers for the same run.
 */
export function jobRunCompletion(result: AgentResult): {
  status: "ok" | "error";
  error?: string;
} {
  return result.ok
    ? { status: "ok" }
    : { status: "error", error: result.summary };
}

export interface DownstreamEnqueueFailure {
  agent: string;
  reason: string;
}

/**
 * Turn an unqueued required next step into the result the worker and operator
 * actually need to see.
 *
 * A successful handler has already completed its canonical work by the time
 * the runner reaches the downstream queue loop. Marking this failure
 * permanent prevents pg-boss from replaying that completed work just to try
 * the child enqueue again. Recovery or an operator can retry the named child
 * step without duplicating the parent action.
 */
export function withDownstreamEnqueueFailures(
  result: AgentResult,
  failures: DownstreamEnqueueFailure[]
): AgentResult {
  if (failures.length === 0) return result;
  const details = failures.map((failure) => `${failure.agent}: ${failure.reason}`).join("; ");
  const completed = result.ok;
  return {
    ...result,
    ok: false,
    permanent: completed ? true : result.permanent,
    humanActionRequired: true,
    // The declarations have already been attempted by this runner. Returning
    // them again invites a caller to enqueue the successful ones twice.
    enqueued: [],
    summary:
      `${result.summary} Required downstream work was not queued: ${details}. ` +
      (completed
        ? "The completed parent step will not run again automatically. Resolve the queue or automation hold, then retry the named downstream step."
        : "Resolve the queue or automation hold before retrying."),
    data: {
      ...(result.data ?? {}),
      canonicalWorkCompleted: completed,
      downstreamEnqueueFailures: failures,
    },
  };
}

/** A safe, useful sentence for an unknown rejection value. */
function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const value = String(error).trim();
  return value && value !== "undefined" ? value : "unknown failure";
}

/**
 * A failed final job_runs write cannot leave an otherwise healthy result.
 * When canonical work succeeded it is not replayed merely to repair audit
 * bookkeeping; the failed durable status remains an attention item instead.
 */
function withJobRunPersistenceFailure(
  result: AgentResult,
  reason: string,
  canonicalWorkCompleted: boolean
): AgentResult {
  return {
    ...result,
    ok: false,
    permanent: canonicalWorkCompleted ? true : result.permanent,
    humanActionRequired: true,
    summary:
      `${result.summary} Automation Health could not record the final run status: ${reason}. ` +
      (canonicalWorkCompleted
        ? "The completed agent work will not run again automatically; repair database health and reconcile this run."
        : "Repair database health, then retry this run."),
    data: {
      ...(result.data ?? {}),
      canonicalWorkCompleted,
      jobRunPersistenceFailure: reason,
    },
  };
}

/**
 * Settle the exact recovery claim carried by the queue-owned payload marker.
 *
 * Both identifiers are replaced by enqueue(), never accepted from a request
 * payload. The row is additionally matched to its organization and agent, so
 * even a malformed internal job cannot settle unrelated recovery work.
 */
async function settleRecoveryRequeue(
  payload: Record<string, unknown>,
  agent: string,
  outcome: "succeeded" | "failed"
): Promise<void> {
  const id = payload[RECOVERY_REQUEUE_KEY];
  const orgId = payload[ENQUEUED_BY_ORG_KEY];
  if (typeof id !== "string" || typeof orgId !== "string") return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return;
  }
  await query(
    `update incident_requeues
        set outcome=$4, outcome_at=now()
      where id=$1 and org_id=$2 and agent=$3
        and outcome in ('queued','failed')`,
    [id, orgId, agent, outcome]
  );
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
  const finish = async (result: AgentResult, handlerRan = false): Promise<AgentResult> => {
    await settleRecoveryRequeue(
      payload,
      def.name,
      handlerRan && result.ok ? "succeeded" : "failed"
    ).catch((error) => {
      console.error(
        `[runner] recovery outcome could not be recorded for ${def.name}:`,
        (error as Error).message
      );
    });
    return result;
  };

  if (config.worker.disabledAgents.includes(def.name)) {
    return finish({ ok: true, summary: `${def.name} is disabled via DISABLED_AGENTS` });
  }

  /*
   * Two pause checks, because there are two different questions and they used
   * to be one row answering both badly.
   *
   * This one is the platform kill switch: an Anthropic-side or infrastructure
   * emergency where nothing should run for anybody. It has its own unscoped
   * key, so reading it needs no tenant context and it is checked first.
   */
  const { isPlatformAutomationPaused, isAutomationPaused } = await import("../app-settings");
  if (await isPlatformAutomationPaused()) {
    return finish({
      ok: true,
      summary: `${def.name} skipped: automation is paused platform-wide`,
    });
  }

  const { orgId, missing, conflict } = await payloadOrgId(def.name, payload);
  const inOrg = <T>(fn: () => Promise<T>): Promise<T> =>
    orgId === null ? fn() : runWithOrg(orgId, fn);
  const exposeJobRunPersistenceFailure = async (
    result: AgentResult,
    reason: string,
    canonicalWorkCompleted: boolean
  ): Promise<AgentResult> => {
    const failed = withJobRunPersistenceFailure(result, reason, canonicalWorkCompleted);
    await inOrg(() =>
      logAgent({
        agent: def.name,
        action: "job-run-finish-failed",
        level: "error",
        status: "error",
        message: failed.summary,
        ...recordRefs(payload),
        output: { jobRunPersistenceFailure: reason, canonicalWorkCompleted },
      })
    );
    return failed;
  };

  if (conflict) {
    return finish({
      ok: false,
      permanent: true,
      summary: `${def.name} abandoned: payload names records from two organizations. Nothing was run.`,
    });
  }

  /*
   * And this one is the customer's own switch, which is why it has to come
   * AFTER the organization is resolved.
   *
   * app_settings keys are tenant-scoped as "<orgId>:automation", with the
   * founding organization keeping the bare key. Read before this line there is
   * no async-local context and no signed-in user, so tryResolveTenantOrgId
   * falls back to LEGACY_ORG_ID and the lookup lands on the founding
   * organization's row. That produced two wrong answers at once: a customer
   * who paused their automation had their queued jobs keep running, and the
   * founding organization pausing its own automation stopped every customer on
   * the platform.
   *
   * Nothing below this point reads, writes, enqueues, calls the AI, or
   * contacts anybody, so a paused organization stops here before any of it.
   */
  if (orgId !== null && (await inOrg(() => isAutomationPaused()))) {
    return finish({
      ok: true,
      summary: `${def.name} skipped: this account has automation paused`,
    });
  }

  /*
   * And the third stop: has the operator stopped THIS pursuit?
   *
   * Dismissing an opportunity and moving its stage never stopped work already
   * in flight, so a queued follow-up still went out and a recovery sweep still
   * re-enqueued scoring for a bid nobody was submitting. From the
   * subcontractor's side that is an email about an abandoned job, over the
   * operator's name, days later.
   *
   * Checked here rather than in each agent for the same reason the org check
   * is: there are two dozen agents, and the next one somebody writes gets this
   * without having to know to ask. Agents that then send do their own check
   * immediately before sending, because this one is minutes stale by then.
   *
   * `permanent: true` so the queue does not retry. A stopped pursuit is a
   * decision, not a transient failure, and retrying it with backoff would fill
   * the log with the same refusal three times per job.
   */
  const pursuitId = typeof payload.opportunityId === "string" ? payload.opportunityId : "";
  let guardedPursuitVersion: number | null = null;
  // Missing or malformed records must reach the durable abandonment path.
  // They have no pursuit version, which is not evidence of an abort/restart.
  if (pursuitId && missing.length === 0) {
    const pursuit = await pursuitStatus(pursuitId);
    const mayRunAfterClose =
      def.name === "sub-onboarding" && payload[CLOSED_OPPORTUNITY_JOB_KEY] === true;
    if (!pursuit.mayAct && pursuit.known && !mayRunAfterClose) {
      const summary = `${def.name} skipped: ${pursuit.reason}`;
      await inOrg(() =>
        logAgent({
          agent: def.name,
          action: "pursuit-stopped",
          level: "info",
          status: "skipped",
          opportunityId: pursuitId,
          message: summary,
        })
      );
      return finish({ ok: true, permanent: true, summary });
    }
    const rawVersion = payload[PURSUIT_VERSION_KEY];
    const payloadVersion =
      typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion >= 1
        ? rawVersion
        : null;
    const staleQueuedJob =
      trigger === "queue" &&
      (pursuit.version == null ||
        (payloadVersion == null ? pursuit.version !== 1 : payloadVersion !== pursuit.version));
    if (staleQueuedJob) {
      const summary =
        `${def.name} skipped: this job was queued for an earlier pursuit version. ` +
        "Nothing ran after the abort and restart.";
      await inOrg(() =>
        logAgent({
          agent: def.name,
          action: "stale-pursuit-job",
          level: "warn",
          status: "skipped",
          opportunityId: pursuitId,
          message: summary,
        })
      );
      return finish({ ok: true, permanent: true, summary });
    }
    guardedPursuitVersion = payloadVersion ?? pursuit.version;
  }
  const runId = randomUUID();
  const started = Date.now();
  /*
   * `orgId` and not `payload.orgId`. payloadOrgId resolves it from the OWNER
   * of the records the payload names, and a record always beats the payload's
   * own claim; the raw field is only a seed for a job that names no record at
   * all. Writing the unverified field here would let whatever enqueued the job
   * choose which customer's Automation Health page its run appears on.
   *
   * Null when nothing could establish an owner: a cron sweep with no payload,
   * which does its own per-organization loop below this. Null means platform
   * work, and the customer-facing queries exclude it rather than showing every
   * tenant a run they cannot account for.
   */
  /*
   * The record this job is about, when it names one.
   *
   * Recorded because a recovery has to decide what is worth replaying, and
   * every one of those decisions is about the record: does the opportunity
   * still exist, did the operator stop this pursuit, has the deadline passed,
   * did a later run already do this work. Without it a recovery either replays
   * everything blindly or replays nothing.
   *
   * Read from the payload rather than resolved, unlike `orgId`. It is not a
   * permission claim, it is a note about what the job was doing, and if the
   * payload names a record that turns out not to exist the run is abandoned a
   * few lines below anyway.
   */
  const namedOpportunityId =
    typeof payload.opportunityId === "string" && payload.opportunityId ? payload.opportunityId : null;
  /*
   * Dropped when the opportunity is one of the records that turned out to be
   * gone.
   *
   * job_runs.opportunity_id is a foreign key, so writing the id of a deleted
   * opportunity made the insert fail, the old swallowed rejection turned that
   * into null, and the abandonment a few lines further down had no run row to
   * finish. The one outcome the comment there insists must leave a trace was
   * the only outcome that left none, and it failed silently in exactly the
   * case it was written for. The id is still named in the abandonment message.
   */
  const runOpportunityId =
    namedOpportunityId && missing.some((m) => m.id === namedOpportunityId)
      ? null
      : namedOpportunityId;
  let jobRun: { id: string } | null = null;
  let jobRunStartFailure: string | null = null;
  try {
    jobRun = await queryOne<{ id: string }>(
      `insert into job_runs (agent, trigger, status, org_id, opportunity_id)
       values ($1,$2,'running',$3,$4) returning id`,
      [def.name, trigger, orgId, runOpportunityId]
    );
    if (!jobRun?.id) jobRunStartFailure = "the database returned no run identifier";
  } catch (error) {
    jobRunStartFailure = failureMessage(error);
  }

  /*
   * No durable run row means no external or canonical work may begin. Letting
   * the handler continue here made provider calls and writes that Automation
   * Health could never account for. This is retryable because nothing in the
   * handler ran; a recovered database can safely start the work later.
   */
  if (jobRunStartFailure || !jobRun?.id) {
    const reason = jobRunStartFailure ?? "the database returned no run identifier";
    const summary =
      `${def.name} did not start because its durable run record could not be created: ${reason}. ` +
      "No agent work was performed. Repair database health, then retry.";
    await inOrg(() =>
      logAgent({
        agent: def.name,
        action: "job-run-start-failed",
        level: "error",
        status: "error",
        message: summary,
        ...recordRefs(payload),
      })
    );
    return finish({ ok: false, humanActionRequired: true, summary });
  }

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
    const result: AgentResult = { ok: false, permanent: true, summary };
    const persistenceFailure = await finishJobRun(
      jobRun.id,
      "error",
      result,
      Date.now() - started,
      summary
    );
    return finish(
      persistenceFailure
        ? await exposeJobRunPersistenceFailure(result, persistenceFailure, false)
        : result
    );
  }

  try {
    // Inside the org, like everything else that reads a credential. Outside
    // it, claudeEnabled() resolved to the founding organization: a tenant with
    // their own key had every AI agent skipped as "not set" whenever the
    // founding org had none, and a tenant with no key was let through on
    // somebody else's.
    // A payload-free cron fanout has no single credential to check here. Its
    // handler enters each organization and handles availability there. Using
    // the founding account as a proxy would skip or admit every tenant based
    // on somebody else's key.
    if (orgId !== null && !(await inOrg(() => claudeEnabled())) && !def.worksWithoutClaude) {
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
          ...recordRefs(payload),
        })
      );
      const persistenceFailure = await finishJobRun(
        jobRun.id,
        "ok",
        result,
        Date.now() - started
      );
      return finish(
        persistenceFailure
          ? await exposeJobRunPersistenceFailure(result, persistenceFailure, false)
          : result
      );
    }

    const runHandler = () => inOrg(() => withApiUsageContext({ feature: def.name, workflow: runId, relatedId: pursuitId ?? undefined }, () => def.handler({ runId, trigger, payload })));
    const result =
      pursuitId && guardedPursuitVersion != null
        ? await runWithPursuitVersion(
            { opportunityId: pursuitId, version: guardedPursuitVersion },
            runHandler
          )
        : await runHandler();

    await inOrg(() =>
      logAgent({
        agent: def.name,
        action: "run",
        level: result.ok ? "success" : "warn",
        status: result.ok ? "ok" : "error",
        message: result.summary,
        reasoning: result.reasoning,
        ...recordRefs(payload),
        output: result.data,
        durationMs: Date.now() - started,
      })
    );

    // Enqueue downstream work declared by the agent. The org is passed in
    // rather than inherited from the context, because this loop deliberately
    // runs outside it: enqueue() reads the automation pause switch, which is
    // per organization, and wrapping the loop would change whose switch that
    // check reads. An agent that names an org itself keeps it.
    const downstreamFailures: DownstreamEnqueueFailure[] = [];
    for (const next of result.enqueued ?? []) {
      const queueNext = () =>
        enqueue(next.agent, next.payload, {
          ...next.opts,
          ...(orgId ? { orgId } : {}),
        });
      try {
        const queued =
          pursuitId && guardedPursuitVersion != null
            ? await runWithPursuitVersion(
                { opportunityId: pursuitId, version: guardedPursuitVersion },
                queueNext
              )
            : await queueNext();
        if (!queued) {
          downstreamFailures.push({
            agent: next.agent,
            reason:
              "the queue refused this required step. Automation may be paused, the pursuit may be stopped, or its version may be unavailable",
          });
        }
      } catch (error) {
        downstreamFailures.push({ agent: next.agent, reason: failureMessage(error) });
      }
    }

    const finalResult = withDownstreamEnqueueFailures(result, downstreamFailures);
    if (downstreamFailures.length > 0) {
      await inOrg(() =>
        logAgent({
          agent: def.name,
          action: "downstream-enqueue-failed",
          level: "error",
          status: "error",
          message: finalResult.summary,
          ...recordRefs(payload),
          output: { downstreamEnqueueFailures: downstreamFailures },
          durationMs: Date.now() - started,
        })
      );
    }

    const completion = jobRunCompletion(finalResult);
    const persistenceFailure = await finishJobRun(
      jobRun.id,
      completion.status,
      finalResult,
      Date.now() - started,
      completion.error
    );
    return finish(
      persistenceFailure
        ? await exposeJobRunPersistenceFailure(finalResult, persistenceFailure, result.ok)
        : finalResult,
      true
    );
  } catch (err) {
    const message = failureMessage(err);
    const result: AgentResult = { ok: false, summary: message };
    await inOrg(() =>
      logAgent({
        agent: def.name,
        action: "run",
        level: "error",
        status: "error",
        message,
        ...recordRefs(payload),
      })
    );
    const persistenceFailure = await finishJobRun(
      jobRun.id,
      "error",
      result,
      Date.now() - started,
      message
    );
    // Isolation: do not rethrow. One agent's failure must not cascade.
    return finish(
      persistenceFailure
        ? await exposeJobRunPersistenceFailure(result, persistenceFailure, false)
        : result,
      true
    );
  }
}

async function finishJobRun(
  id: string,
  status: "ok" | "error",
  result: AgentResult,
  _durationMs: number,
  error?: string
): Promise<string | null> {
  try {
    await query(
      `update job_runs set status=$2, finished_at=now(), error=$3, summary=$4 where id=$1`,
      [id, status, error ?? null, JSON.stringify({ summary: result.summary, data: result.data })]
    );
    return null;
  } catch (writeError) {
    return failureMessage(writeError);
  }
}
