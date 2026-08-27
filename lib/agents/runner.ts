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
    return {
      ok: true,
      summary: `${def.name} skipped: automation is paused platform-wide`,
    };
  }

  const { orgId, missing } = await payloadOrgId(def.name, payload);
  const inOrg = <T>(fn: () => Promise<T>): Promise<T> =>
    orgId === null ? fn() : runWithOrg(orgId, fn);

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
    return {
      ok: true,
      summary: `${def.name} skipped: this account has automation paused`,
    };
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
  if (pursuitId) {
    const pursuit = await pursuitStatus(pursuitId);
    if (!pursuit.mayAct && pursuit.known) {
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
      return { ok: true, permanent: true, summary };
    }
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
   * opportunity made the insert fail, the `.catch` below turned that into
   * null, and the abandonment a few lines further down had no run row to
   * finish. The one outcome the comment there insists must leave a trace was
   * the only outcome that left none, and it failed silently in exactly the
   * case it was written for. The id is still named in the abandonment message.
   */
  const runOpportunityId =
    namedOpportunityId && missing.some((m) => m.id === namedOpportunityId)
      ? null
      : namedOpportunityId;
  const jobRun = await queryOne<{ id: string }>(
    `insert into job_runs (agent, trigger, status, org_id, opportunity_id)
     values ($1,$2,'running',$3,$4) returning id`,
    [def.name, trigger, orgId, runOpportunityId]
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
          ...recordRefs(payload),
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
        ...recordRefs(payload),
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
