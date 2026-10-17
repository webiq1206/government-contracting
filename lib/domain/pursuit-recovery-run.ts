/**
 * Put back pursue work the one-shot enqueue lost.
 *
 * Band decisions are queued onto the scoring engine with `bandDecisionOnly`,
 * which reads the saved score and does not bill another rubric. Sub Finder,
 * Sub Verify, and Outreach are queued from the rows that are already waiting.
 * A singleton keeps a second sweep from stacking the same job. Quote requests
 * stay unsent while outbound mail is paused.
 */
import { query, queryOne } from "../db";
import { enqueue } from "../queue";
import { logAgent } from "../logger";
import { runWithOrg } from "../tenant-context";
import { getAutomationRules } from "../app-settings";
import { getProfileJson } from "../ai/companyProfile";
import { normalizeRules } from "./intake";
import { outreachAllowedSql } from "./work-mode";
import { deliverOutageAlert } from "../outage-alert";
import { advance, IllegalTransition, openOrUpdateIncident } from "../incidents";
import {
  BAND_STALL_HOURS,
  PIPELINE_STALL_CAUSE,
  RFQ_STALL_HOURS,
  SOURCING_STALL_HOURS,
  pipelineStallDecision,
  pipelineStallEligible,
  pipelineStallText,
  type PipelineStallCounts,
} from "./pipeline-stall";

export interface PursuitGapResult {
  bandQueued: number;
  sourcingQueued: number;
  verifyQueued: number;
  outreachQueued: number;
  queueFailures: number;
  alerted: number;
  resolved: number;
}

const EMPTY: PursuitGapResult = {
  bandQueued: 0,
  sourcingQueued: 0,
  verifyQueued: 0,
  outreachQueued: 0,
  queueFailures: 0,
  alerted: 0,
  resolved: 0,
};

export async function recoverOpenPursuitGaps(orgIds: string[]): Promise<PursuitGapResult> {
  const totals = { ...EMPTY };
  for (const orgId of orgIds) {
    const one = await runWithOrg(orgId, () => recoverOrgGaps(orgId));
    totals.bandQueued += one.bandQueued;
    totals.sourcingQueued += one.sourcingQueued;
    totals.verifyQueued += one.verifyQueued;
    totals.outreachQueued += one.outreachQueued;
    totals.queueFailures += one.queueFailures;
    totals.alerted += one.alerted;
    totals.resolved += one.resolved;
  }
  return totals;
}

async function recoverOrgGaps(orgId: string): Promise<PursuitGapResult> {
  const result = { ...EMPTY };
  const rules = normalizeRules(await getAutomationRules());
  const profile = await getProfileJson();
  const thresholds = profile?.decision_thresholds ?? { pursue_min_score: 70, review_min_score: 50 };

  if (rules.autonomous_review_decisions) {
    const rows = await query<{ id: string }>(
      `-- band-backfill-candidates
       select id from opportunities
        where org_id = $1
          and status = 'open'
          and tier = 'review'
          and band_decision is null
          and score >= greatest($2::numeric, 50)
          and score <= 69
          and score < $3::numeric
          and stage in ('monitoring', 'scoring', 'analysis')
          and is_sources_sought is not true
          and coalesce(pursuit_state, 'active') = 'active'
          and not (coalesce(risk_flags, '{}') && array[
            'incomplete_scoring', 'value_over_max', 'out_of_service_area',
            'missing_deadline', 'below_min_lead_time', 'possible_duplicate'
          ])
          and coalesce(jsonb_array_length(score_breakdown->'hard_exclusions_triggered'), 0) = 0
          and not exists (
            select 1 from agent_logs l
             where l.org_id = $1 and l.opportunity_id = opportunities.id
               and l.agent = 'scoring-engine' and l.action = 'band-decision-ineligible'
               and l.created_at > now() - interval '24 hours'
          )
        order by updated_at asc
        limit 50`,
      [orgId, thresholds.review_min_score, thresholds.pursue_min_score]
    );
    for (const row of rows) {
      const queued = await tryQueue(orgId, result, "scoring-engine", {
        opportunityId: row.id,
        bandDecisionOnly: true,
        trigger: "band-backfill",
      }, `band-decision:${row.id}`, 900);
      if (queued) result.bandQueued += 1;
    }
  }

  const outreachSql = outreachAllowedSql("o", "$2");
  const sources = await query<{ id: string }>(
    `-- pursue-source-candidates
     select o.id from opportunities o
      where o.org_id = $1
        and o.status = 'open'
        and o.tier = 'pursue'
        and coalesce(o.pursuit_state, 'active') = 'active'
        and o.is_sources_sought is not true
        and o.solicitation_analysis is not null
        and ${outreachSql}
        and (
          o.stage in ('analysis', 'sub_research')
          or (
            o.stage = 'scoring'
            and coalesce(o.score_breakdown->>'analysis_input_hash', '') <> ''
            and o.score_breakdown->>'analysis_input_hash' = o.analysis_input_hash
          )
        )
        and not exists (
          select 1 from opportunity_subs os
           where os.opportunity_id = o.id and os.removed_at is null
        )
      order by o.updated_at asc
      limit 50`,
    [orgId, rules.work_execution]
  );
  for (const row of sources) {
    const priced = await tryQueue(orgId, result, "pricing-research", { opportunityId: row.id }, `pricing-research:${row.id}`, 3600);
    const sourced = await tryQueue(orgId, result, "sub-finder", { opportunityId: row.id }, `sub-finder:${row.id}`, 3600);
    if (priced || sourced) result.sourcingQueued += 1;
  }

  const verifies = await query<{ opportunity_id: string; subcontractor_id: string; trade: string }>(
    `-- pursue-verify-candidates
     select os.opportunity_id, os.subcontractor_id, coalesce(os.trade, '') as trade
       from opportunity_subs os
       join opportunities o on o.id = os.opportunity_id and o.org_id = os.org_id
      where os.org_id = $1
        and o.status = 'open'
        and o.tier = 'pursue'
        and coalesce(o.pursuit_state, 'active') = 'active'
        and o.is_sources_sought is not true
        and os.removed_at is null
        and os.verified is not true
        and os.outreach_state in ('pending', 'draft', 'email_unverified')
        and ${outreachSql}
      order by os.created_at asc
      limit 50`,
    [orgId, rules.work_execution]
  );
  for (const row of verifies) {
    const queued = await tryQueue(
      orgId,
      result,
      "sub-verify",
      { opportunityId: row.opportunity_id, subcontractorId: row.subcontractor_id, trade: row.trade },
      `verify:${row.opportunity_id}:${row.subcontractor_id}:${row.trade}`,
      3600
    );
    if (queued) result.verifyQueued += 1;
  }

  if (rules.rfq_outbound_enabled) {
    const sends = await query<{ opportunity_id: string; subcontractor_id: string; trade: string }>(
      `-- pursue-outreach-candidates
       select os.opportunity_id, os.subcontractor_id, coalesce(os.trade, '') as trade
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id and o.org_id = $1
         join subcontractors s on s.id = os.subcontractor_id and s.org_id = $1
        where os.org_id = $1
          and o.status = 'open'
          and o.tier = 'pursue'
          and coalesce(o.pursuit_state, 'active') = 'active'
          and o.is_sources_sought is not true
          and os.removed_at is null
          and os.verified is true
          and s.email_verified is true
          and nullif(btrim(coalesce(s.email, '')), '') is not null
          and os.outreach_state in ('pending', 'draft')
          and ${outreachSql}
        order by os.created_at asc
        limit 50`,
      [orgId, rules.work_execution]
    );
    for (const row of sends) {
      const queued = await tryQueue(
        orgId,
        result,
        "outreach",
        { opportunityId: row.opportunity_id, subcontractorId: row.subcontractor_id, trade: row.trade },
        `rfq:${row.opportunity_id}:${row.subcontractor_id}:${row.trade}`,
        3600
      );
      if (queued) result.outreachQueued += 1;
    }
  }

  const watched = await watchPipeline(orgId, rules.rfq_outbound_enabled);
  result.alerted += watched.alerted;
  result.resolved += watched.resolved;

  const moved = result.bandQueued + result.sourcingQueued + result.verifyQueued + result.outreachQueued;
  if (moved > 0) {
    await logAgent({
      agent: "scoring-recovery-sweep",
      action: "requeue-pursuit",
      level: "info",
      message:
        `Queued ${result.bandQueued} band decision(s), ${result.sourcingQueued} sourcing job(s), ` +
        `${result.verifyQueued} verification(s), and ${result.outreachQueued} quote request(s) ` +
        "for pursue work that had no next step.",
    });
  }
  return result;
}

async function tryQueue(
  orgId: string,
  result: PursuitGapResult,
  agent: string,
  payload: Record<string, unknown>,
  singletonKey: string,
  singletonSeconds: number
): Promise<boolean> {
  try {
    const queued = await enqueue(agent, payload, { orgId, singletonKey, singletonSeconds });
    return Boolean(queued);
  } catch (error) {
    result.queueFailures += 1;
    await logAgent({
      agent: "scoring-recovery-sweep",
      action: "requeue-pursuit",
      level: "error",
      status: "error",
      opportunityId: typeof payload.opportunityId === "string" ? payload.opportunityId : undefined,
      message: `Could not queue ${agent} (${error instanceof Error ? error.message : "unknown error"}). The next sweep will try again.`,
    });
    return false;
  }
}

async function watchPipeline(
  orgId: string,
  outboundEnabled: boolean
): Promise<{ alerted: number; resolved: number }> {
  const counts = await stallCounts(orgId, outboundEnabled);
  const open = await queryOne<{ id: string }>(
    `select id from automation_incidents
      where org_id = $1 and cause = $2 and state not in ('recovered', 'retired')
      limit 1`,
    [orgId, PIPELINE_STALL_CAUSE]
  );
  const decision = pipelineStallDecision({
    eligible: pipelineStallEligible(counts),
    incidentOpen: Boolean(open),
  });
  if (decision === "quiet") return { alerted: 0, resolved: 0 };
  if (decision === "alert") {
    const incident = open ?? (await openOrUpdateIncident({
      orgId,
      cause: PIPELINE_STALL_CAUSE,
      severity: "blocking",
      startedAt: new Date(),
      detectionSource: "scoring_recovery_sweep",
      failedCount: 1,
      recommendedAction: "The recovery sweep queues the missing band decision, verification, or quote request. Confirm the next run moves one of those rows.",
    }));
    if (!(await claimAlert(orgId, incident.id, "start"))) return { alerted: 0, resolved: 0 };
    const text = pipelineStallText(counts);
    await deliverOutageAlert({ subject: "Pursue work is waiting", text });
    await logAgent({
      agent: "scoring-recovery-sweep",
      action: "pipeline-stall-alert",
      level: "warn",
      message: text,
    });
    return { alerted: 1, resolved: 0 };
  }
  if (!open) return { alerted: 0, resolved: 0 };
  const note = "The waiting band decisions, verifications, or quote requests have cleared.";
  if (await claimAlert(orgId, open.id, "end")) {
    await deliverOutageAlert({ subject: "Pursue work resumed", text: note });
  }
  await markRecovered(orgId, open.id, note);
  return { alerted: 0, resolved: 1 };
}

async function stallCounts(orgId: string, outboundEnabled: boolean): Promise<PipelineStallCounts> {
  const row = await queryOne<{
    undecided_band: number;
    band_decisions: number;
    unsourced: number;
    finder_runs: number;
    unverified: number;
    verify_runs: number;
    unsent: number;
    outreach_runs: number;
  }>(
    `-- pipeline-stall-counts
     select
       (select count(*)::int from opportunities o
         where o.org_id = $1 and o.status = 'open' and o.tier = 'review'
           and o.band_decision is null and o.score >= 50 and o.score <= 69
           and o.stage in ('monitoring', 'scoring', 'analysis')
           and not ('incomplete_scoring' = any(coalesce(o.risk_flags, '{}')))
           and o.is_sources_sought is not true
           and coalesce(o.pursuit_state, 'active') = 'active'
           and o.updated_at < now() - ($2::text || ' hours')::interval) as undecided_band,
       (select count(*)::int from agent_logs l
         where l.org_id = $1 and l.agent = 'scoring-engine' and l.action = 'band-decision'
           and l.created_at > now() - ($2::text || ' hours')::interval) as band_decisions,
       (select count(*)::int from opportunities o
         where o.org_id = $1 and o.status = 'open' and o.tier = 'pursue'
           and coalesce(o.pursuit_state, 'active') = 'active'
           and o.solicitation_analysis is not null
           and o.is_sources_sought is not true
           and (
             o.stage in ('analysis', 'sub_research')
             or (
               o.stage = 'scoring'
               and coalesce(o.score_breakdown->>'analysis_input_hash', '') <> ''
               and o.score_breakdown->>'analysis_input_hash' = o.analysis_input_hash
             )
           )
           and o.updated_at < now() - ($2::text || ' hours')::interval
           and not exists (
             select 1 from opportunity_subs os
              where os.opportunity_id = o.id and os.removed_at is null
           )) as unsourced,
       (select count(*)::int from job_runs j
         where j.org_id = $1 and j.agent = 'sub-finder'
           and j.started_at > now() - ($2::text || ' hours')::interval) as finder_runs,
       (select count(*)::int from opportunity_subs os
          join opportunities o on o.id = os.opportunity_id and o.org_id = os.org_id
         where os.org_id = $1 and o.status = 'open' and o.tier = 'pursue'
           and coalesce(o.pursuit_state, 'active') = 'active'
           and os.removed_at is null and os.verified is not true
           and os.outreach_state in ('pending', 'draft', 'email_unverified')
           and os.created_at < now() - ($2::text || ' hours')::interval) as unverified,
       (select count(*)::int from job_runs j
         where j.org_id = $1 and j.agent = 'sub-verify'
           and j.started_at > now() - ($2::text || ' hours')::interval) as verify_runs,
       (select count(*)::int from opportunity_subs os
          join opportunities o on o.id = os.opportunity_id and o.org_id = $1
          join subcontractors s on s.id = os.subcontractor_id and s.org_id = $1
         where os.org_id = $1 and o.status = 'open' and o.tier = 'pursue'
           and coalesce(o.pursuit_state, 'active') = 'active'
           and os.removed_at is null and os.verified is true and s.email_verified is true
           and nullif(btrim(coalesce(s.email, '')), '') is not null
           and os.outreach_state in ('pending', 'draft')
           and os.created_at < now() - ($3::text || ' hours')::interval) as unsent,
       (select count(*)::int from job_runs j
         where j.org_id = $1 and j.agent = 'outreach'
           and j.started_at > now() - ($3::text || ' hours')::interval) as outreach_runs`,
    [orgId, String(Math.min(BAND_STALL_HOURS, SOURCING_STALL_HOURS)), String(RFQ_STALL_HOURS)]
  );
  return {
    undecidedBand: Number(row?.undecided_band ?? 0),
    bandDecisions: Number(row?.band_decisions ?? 0),
    unsourcedPursue: Number(row?.unsourced ?? 0),
    finderRuns: Number(row?.finder_runs ?? 0),
    unverifiedPairings: Number(row?.unverified ?? 0),
    verifyRuns: Number(row?.verify_runs ?? 0),
    unsentVerified: Number(row?.unsent ?? 0),
    outreachRuns: Number(row?.outreach_runs ?? 0),
    outboundPaused: !outboundEnabled,
  };
}

async function claimAlert(orgId: string, incidentId: string, kind: "start" | "end"): Promise<boolean> {
  const column = kind === "start" ? "start_alert_at" : "end_alert_at";
  const row = await queryOne<{ id: string }>(
    `update automation_incidents
        set ${column} = now()
      where id = $1 and org_id = $2 and ${column} is null
      returning id`,
    [incidentId, orgId]
  );
  return Boolean(row);
}

async function markRecovered(orgId: string, incidentId: string, note: string): Promise<void> {
  const steps = ["mitigating", "provider_restored", "test_passed", "recovered"] as const;
  for (const step of steps) {
    try {
      await advance({
        incidentId,
        orgId,
        to: step,
        actor: "scoring-recovery-sweep",
        detail: step === "recovered" ? note : undefined,
        set: step === "recovered" ? { recoveryNote: note, recoveryOwner: "scoring-recovery-sweep" } : undefined,
      });
    } catch (error) {
      if (!(error instanceof IllegalTransition)) throw error;
    }
  }
}
