/**
 * Run recovery check: prove the provider works, then put back only the work
 * that is still worth doing.
 *
 * The shape of this is set by one rule from the instructions, which is that an
 * incident becomes Recovered only after the queue and workflow checks pass.
 * Everything here exists to make that rule enforceable rather than aspirational:
 *
 *   1. Ask the provider something small and see what comes back.
 *   2. Find the failures this incident actually caused.
 *   3. Decide which of them are still worth replaying, and say why not for the
 *      rest.
 *   4. Requeue those, once, under a key that a second press cannot duplicate.
 *   5. Report what is left.
 *   6. Only call it recovered when a downstream record has actually changed.
 *
 * The step people skip is the last one. Funding an account and seeing the red
 * go away is not a recovery; it is a quieter screen.
 */
import { query, queryOne } from "./db";
import { complete, describeClaudeFailure } from "./ai/claude";
import { config } from "./config";
import { enqueue } from "./queue";
import { logAgent } from "./logger";
import { advance, incidentById, type IncidentRow } from "./incidents";
import {
  describePlan,
  planReplay,
  replayDecision,
  replayKey,
  type JobFailure,
  type ReplayContext,
} from "./domain/incident";

export interface ProviderTest {
  passed: boolean;
  /** Plain English, safe to show an operator. Never a raw provider payload. */
  detail: string;
  /** The full text, for support and platform admin only. */
  technical: string | null;
  model: string;
}

/**
 * Ask the model something small and see what comes back.
 *
 * A real request, not a ping. An account can have a valid key, a reachable
 * endpoint, and no ability to pay for a single token, and only a request that
 * spends something tells those apart.
 *
 * `describeClaudeFailure` returning null means the failure was not an
 * availability problem at all, which is our bug rather than the account's. It
 * still fails the test, because something is wrong, but it says so honestly
 * instead of sending somebody to top up an account that was never the problem.
 */
export async function testProvider(): Promise<ProviderTest> {
  const model = config.claude.modelSmart;
  try {
    const { text } = await complete(
      "Reply with the single word: ready. Nothing else.",
      { model, maxTokens: 16 }
    );
    const got = text.trim().toLowerCase();
    if (!got) {
      return {
        passed: false,
        detail: "The provider accepted the request but returned nothing.",
        technical: "empty completion",
        model,
      };
    }
    return {
      passed: true,
      detail: `The provider answered a test request on ${model}.`,
      technical: `completion: ${got.slice(0, 200)}`,
      model,
    };
  } catch (err) {
    const described = describeClaudeFailure(err);
    return {
      passed: false,
      detail:
        described?.reason ??
        "The provider refused the test request for a reason that is not an account or service problem. This is likely a fault on our side.",
      technical: (err as Error).message ?? String(err),
      model,
    };
  }
}

/**
 * The failures this incident caused, with the facts that decide whether each
 * one is still worth replaying.
 *
 * Every flag is a question about the world NOW rather than about the failure
 * then, which is why they are gathered here in one query rather than assumed
 * from the failure row.
 */
async function failuresWithContext(
  incident: IncidentRow
): Promise<{ failure: JobFailure; context: ReplayContext }[]> {
  const rows = await query<{
    id: string;
    agent: string;
    opportunity_id: string | null;
    started_at: Date;
    error: string | null;
    record_missing: boolean;
    pursuit_stopped: boolean;
    deadline_passed: boolean;
    superseded: boolean;
    already_requeued: boolean;
  }>(
    `select jr.id, jr.agent, jr.opportunity_id, jr.started_at, jr.error,
            (jr.opportunity_id is not null and o.id is null)          as record_missing,
            coalesce(o.pursuit_state, 'active') <> 'active'           as pursuit_stopped,
            (o.deadline is not null and o.deadline < now())           as deadline_passed,
            exists (
              select 1 from job_runs later
               where later.agent = jr.agent
                 and later.opportunity_id is not distinct from jr.opportunity_id
                 and later.status = 'ok'
                 and later.started_at > jr.started_at
            )                                                          as superseded,
            exists (
              select 1 from incident_requeues rq
               where rq.source_run_id = jr.id
            )                                                          as already_requeued
       from job_runs jr
       left join opportunities o on o.id = jr.opportunity_id
      where jr.org_id = $1
        and jr.status = 'error'
        and jr.started_at >= $2
      order by jr.started_at
      limit 2000`,
    [incident.orgId, incident.startedAt]
  );

  return rows.map((r) => ({
    failure: {
      id: r.id,
      agent: r.agent,
      opportunityId: r.opportunity_id,
      failedAt: r.started_at,
      error: r.error,
    },
    context: {
      recordMissing: r.record_missing,
      pursuitStopped: r.pursuit_stopped,
      deadlinePassed: r.deadline_passed,
      supersededBySuccess: r.superseded,
      alreadyRequeued: r.already_requeued,
    },
  }));
}

export interface RecoveryResult {
  incidentId: string;
  state: IncidentRow["state"];
  test: ProviderTest;
  /** What the plan was, in a sentence an operator can read. */
  plan: string;
  requeued: number;
  skipped: number;
  remaining: number;
  /** Which downstream record proved the work landed, when one has. */
  confirmation: string | null;
  message: string;
}

/**
 * The whole flow, for one incident.
 *
 * Returns rather than throws on a failed test: a recovery that did not work is
 * an outcome to report, not an exception to swallow, and the incident records
 * the attempt either way.
 */
export async function runRecoveryCheck(
  incidentId: string,
  orgId: string,
  actor: string
): Promise<RecoveryResult> {
  const incident = await incidentById(incidentId, orgId);
  if (!incident) throw new Error("No such incident for this organization.");

  const test = await testProvider();

  if (!test.passed) {
    /*
     * The test is the gate. Everything after it assumes the provider works,
     * and requeueing four hundred jobs into a provider that is still refusing
     * would turn one incident into four hundred more failures.
     */
    const failed = await advance({
      incidentId,
      orgId,
      to: "recovery_failed",
      actor,
      detail: test.detail,
      set: { testRanAt: new Date(), testPassed: false, testDetail: test.technical ?? test.detail },
    }).catch(async () => incidentById(incidentId, orgId));
    await logAgent({
      agent: "recovery-check",
      action: "provider_test_failed",
      level: "warn",
      message: `Recovery check for ${incident.cause}: ${test.detail}`,
    });
    return {
      incidentId,
      state: failed?.state ?? incident.state,
      test,
      plan: "Nothing was requeued: the provider is still refusing requests.",
      requeued: 0,
      skipped: 0,
      remaining: incident.remainingCount,
      confirmation: null,
      message: test.detail,
    };
  }

  // The provider answered. Record that as its own fact before touching the
  // queue, so a crash between here and the requeue leaves a true record
  // rather than an incident that looks untested.
  const afterTest = await moveThrough(incident, "test_passed", orgId, actor, test);

  const candidates = await failuresWithContext(afterTest);
  const decisions = candidates.map((c) =>
    replayDecision(c.failure, incident.cause, c.context)
  );
  const plan = planReplay(decisions);

  let requeued = 0;
  for (const failure of plan.eligible) {
    const key = replayKey(incidentId, failure);
    /*
     * The row is claimed BEFORE the job is enqueued, and the unique index on
     * the key is what makes a second press of the button do nothing. Enqueuing
     * first and recording after would leave a window where two presses both
     * queue the work and only one row survives to say so.
     */
    const claimed = await queryOne<{ id: string }>(
      `insert into incident_requeues
         (incident_id, org_id, source_run_id, agent, opportunity_id, idempotency_key, outcome)
       values ($1,$2,$3,$4,$5,$6,'queued')
       on conflict (idempotency_key) do nothing
       returning id`,
      [incidentId, orgId, failure.id, failure.agent, failure.opportunityId, key]
    );
    if (!claimed) continue;
    const jobId = await enqueue(
      failure.agent,
      failure.opportunityId ? { opportunityId: failure.opportunityId } : {},
      { orgId, singletonKey: key }
    );
    if (jobId) {
      requeued++;
    } else {
      // The queue refused: automation paused, or the pursuit stopped between
      // the eligibility check and here. Mark it rather than leaving a row that
      // claims work is queued when none is.
      await query(
        `update incident_requeues set outcome='failed', outcome_at=now() where idempotency_key=$1`,
        [key]
      );
    }
  }

  const remaining = Math.max(0, plan.eligible.length - requeued);
  const next = requeued > 0 ? "backlog_requeued" : "recovered";
  const confirmation = requeued > 0 ? null : await confirmDownstream(orgId, incident);

  const moved = await moveThrough(afterTest, next, orgId, actor, test, {
    requeuedCount: requeued,
    remainingCount: remaining,
    recoveryOwner: actor,
    recoveryNote:
      requeued > 0
        ? `${requeued} job(s) requeued. ${describePlan(plan)}`
        : (confirmation ?? "Nothing needed requeueing."),
  });

  await logAgent({
    agent: "recovery-check",
    action: "recovery_run",
    level: "info",
    message: `${test.detail} ${describePlan(plan)} ${requeued} requeued.`,
  });

  return {
    incidentId,
    state: moved.state,
    test,
    plan: describePlan(plan),
    requeued,
    skipped: plan.skipped.length,
    remaining,
    confirmation,
    message:
      requeued > 0
        ? `The provider is answering and ${requeued} job(s) are back in the queue. ${describePlan(plan)}`
        : `The provider is answering. ${describePlan(plan)}`,
  };
}

/**
 * Walk an incident to a target state through whatever legal steps it needs.
 *
 * A recovery can start from `detected` (nobody touched it) or from
 * `provider_restored` (somebody funded the account and said so), and the
 * caller should not have to know which. The state machine still refuses
 * anything genuinely illegal; this only spares every call site from spelling
 * out the intermediate hops.
 */
async function moveThrough(
  incident: IncidentRow,
  to: IncidentRow["state"],
  orgId: string,
  actor: string,
  test: ProviderTest,
  set?: Parameters<typeof advance>[0]["set"]
): Promise<IncidentRow> {
  const path: IncidentRow["state"][] =
    to === "test_passed"
      ? ["mitigating", "provider_restored", "test_passed"]
      : to === "backlog_requeued"
        ? ["backlog_requeued", "backlog_draining"]
        : [to];

  let current = incident;
  for (const step of path) {
    if (current.state === step) continue;
    try {
      current = await advance({
        incidentId: incident.id,
        orgId,
        to: step,
        actor,
        detail: step === "test_passed" ? test.detail : undefined,
        set: {
          ...(step === "test_passed"
            ? {
                testRanAt: new Date(),
                testPassed: true,
                testDetail: test.technical ?? test.detail,
                lastProviderSuccessAt: new Date(),
              }
            : {}),
          ...(step === to ? set : {}),
        },
      });
    } catch {
      // Already past this step, or the step is not on this incident's path.
      // The loop continues rather than failing: the target is what matters,
      // and `advance` refuses anything genuinely illegal.
    }
  }
  return (await incidentById(incident.id, orgId)) ?? current;
}

/**
 * Did anything actually happen?
 *
 * The instruction is to confirm a representative downstream record changed
 * correctly, and the reason is that a queue can drain by failing. An agent run
 * that completed is not proof; a record that changed is.
 *
 * Returns a sentence naming the record, or null. Null is the honest answer
 * when nothing has landed yet, and the caller must not treat it as a pass.
 */
export async function confirmDownstream(
  orgId: string,
  incident: IncidentRow
): Promise<string | null> {
  const row = await queryOne<{ agent: string; started_at: Date; opportunity_id: string | null }>(
    `select agent, started_at, opportunity_id
       from job_runs
      where org_id = $1 and status = 'ok' and started_at > $2
      order by started_at desc
      limit 1`,
    [orgId, incident.startedAt]
  );
  if (!row) return null;
  const when = row.started_at.toISOString();
  return row.opportunity_id
    ? `${row.agent} completed against an opportunity at ${when}.`
    : `${row.agent} completed at ${when}.`;
}

/**
 * Move a requeued incident forward as its jobs land.
 *
 * Called by the assessment rather than by a person: an incident whose backlog
 * drained overnight should not still say "draining" in the morning because
 * nobody pressed anything.
 */
export async function reconcileDraining(
  incident: IncidentRow,
  actor = "automation"
): Promise<IncidentRow> {
  if (incident.state !== "backlog_requeued" && incident.state !== "backlog_draining") {
    return incident;
  }
  const counts = await queryOne<{ queued: number; done: number }>(
    `select count(*) filter (where outcome = 'queued')::int as queued,
            count(*) filter (where outcome <> 'queued')::int as done
       from incident_requeues where incident_id = $1`,
    [incident.id]
  );
  const queued = counts?.queued ?? 0;
  if (queued > 0) {
    return advance({
      incidentId: incident.id,
      orgId: incident.orgId,
      to: "backlog_draining",
      actor,
      set: { remainingCount: queued, completedCount: counts?.done ?? 0 },
    }).catch(() => incident);
  }
  /*
   * Nothing left queued. That is necessary and not sufficient: the queue can
   * drain by failing, so a downstream record has to have changed before this
   * says recovered.
   */
  const confirmation = await confirmDownstream(incident.orgId, incident);
  if (!confirmation) return incident;
  return advance({
    incidentId: incident.id,
    orgId: incident.orgId,
    to: "recovered",
    actor,
    detail: confirmation,
    set: { remainingCount: 0, completedCount: counts?.done ?? 0, recoveryNote: confirmation },
  }).catch(() => incident);
}
