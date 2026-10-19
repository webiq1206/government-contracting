/**
 * Put back pursue work the one-shot enqueue lost.
 *
 * Band decisions are queued onto the scoring engine with `bandDecisionOnly`,
 * which reads the saved score and does not bill another rubric. Sub Finder,
 * Sub Verify, and Outreach are queued only when that step never started, or
 * when it was interrupted and is still under the attempt cap. A finished
 * search that paired nobody, and a verification that left the email
 * unverified, are not queued again. Items already parked for a person are
 * left alone. Quote requests stay unsent while outbound mail is paused.
 *
 * A run refused because an earlier attempt was still inside its lease
 * (logged as completion-held) is a wait, not an attempt: it neither counts
 * toward the cap nor starts the backoff, so a worker restart during a call
 * can never park a record on its own.
 */
import type { QueryResultRow } from "pg";
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
import { HANDOFF_ATTEMPT_CAP, handoffAdmission, handoffKey } from "./handoff-policy";
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
  parked: number;
}

const EMPTY: PursuitGapResult = {
  bandQueued: 0,
  sourcingQueued: 0,
  verifyQueued: 0,
  outreachQueued: 0,
  queueFailures: 0,
  alerted: 0,
  resolved: 0,
  parked: 0,
};

const SWEEP_AGENT = "pursuit-continuation-sweep";
const SINGLETON_SECONDS = 600;

interface AttemptFacts {
  finished: boolean;
  attempts: number;
  lastAttemptAt: Date | null;
}

interface Parked {
  ids: Set<string>;
  fresh: string[];
}

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
    totals.parked += one.parked;
  }
  return totals;
}

async function recoverOrgGaps(orgId: string): Promise<PursuitGapResult> {
  const result = { ...EMPTY };
  const now = new Date();
  const inFlight = await loadInFlight(orgId);
  const parked: Parked = { ids: new Set(), fresh: [] };
  const rules = normalizeRules(await getAutomationRules());
  const profile = await getProfileJson();
  const thresholds = profile?.decision_thresholds ?? { pursue_min_score: 70, review_min_score: 50 };

  if (rules.autonomous_review_decisions) {
    const capped = await query<{ id: string; attempts: number | null }>(
      `-- band-backfill-capped
       select opportunities.id, coalesce(band_attempts.attempts, 0) as attempts
         from opportunities
         left join lateral (
           select count(*)::int as attempts
             from agent_logs l
            where l.org_id = opportunities.org_id
              and l.opportunity_id = opportunities.id
              and l.agent = 'scoring-engine'
              and l.action = 'band-decision-waiting'
         ) band_attempts on true
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
          and coalesce(human_action_required, false) is not true
          and coalesce(band_attempts.attempts, 0) >= ${HANDOFF_ATTEMPT_CAP}
        limit 20`,
      [orgId, thresholds.review_min_score, thresholds.pursue_min_score]
    );
    for (const row of capped) {
      await consider(orgId, result, parked, inFlight, now, "scoring-engine", row.id, "", "", {
        opportunityId: row.id,
        bandDecisionOnly: true,
        trigger: "band-backfill",
      }, `band-decision:${row.id}`, readFacts(row));
    }

    const rows = await query<{ id: string; attempts: number | null; last_attempt_at: string | null; finished: boolean | null }>(
      `-- band-backfill-candidates
       select opportunities.id,
              coalesce(band_attempts.attempts, 0) as attempts,
              band_attempts.last_at as last_attempt_at,
              false as finished
         from opportunities
         left join lateral (
           select count(*)::int as attempts, max(l.created_at) as last_at
             from agent_logs l
            where l.org_id = opportunities.org_id
              and l.opportunity_id = opportunities.id
              and l.agent = 'scoring-engine'
              and l.action = 'band-decision-waiting'
         ) band_attempts on true
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
          and coalesce(human_action_required, false) is not true
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
          and coalesce(band_attempts.attempts, 0) < ${HANDOFF_ATTEMPT_CAP}
          and (
            band_attempts.last_at is null
            or (band_attempts.attempts <= 1 and band_attempts.last_at < now() - interval '10 minutes')
            or (band_attempts.attempts = 2 and band_attempts.last_at < now() - interval '30 minutes')
          )
        order by coalesce(band_attempts.attempts, 0) asc,
                 band_attempts.last_at asc nulls first,
                 opportunities.created_at desc
        limit 50`,
      [orgId, thresholds.review_min_score, thresholds.pursue_min_score]
    );
    for (const row of rows) {
      const queued = await consider(orgId, result, parked, inFlight, now, "scoring-engine", row.id, "", "", {
        opportunityId: row.id,
        bandDecisionOnly: true,
        trigger: "band-backfill",
      }, `band-decision:${row.id}`, readFacts(row));
      if (queued) result.bandQueued += 1;
    }
  }

  const outreachSql = outreachAllowedSql("o", "$2");
  const sourceCapped = await query<{ id: string }>(
    `-- pursue-source-capped
     select o.id
       from opportunities o
       left join lateral (
         select bool_or(j.status in ('ok', 'skipped')) as finished,
                count(*) filter (
                  where j.status = 'error'
                     or (j.status = 'running' and j.started_at <= now() - interval '30 minutes')
                )::int as attempts
           from job_runs j
          where j.org_id = o.org_id and j.opportunity_id = o.id and j.agent = 'sub-finder'
       ) finder on true
       left join lateral (
         select bool_or(j.status in ('ok', 'skipped')) as finished,
                count(*) filter (
                  where j.status = 'error'
                     or (j.status = 'running' and j.started_at <= now() - interval '30 minutes')
                )::int as attempts
           from job_runs j
          where j.org_id = o.org_id and j.opportunity_id = o.id and j.agent = 'pricing-research'
       ) pricing on true
      where o.org_id = $1
        and o.status = 'open'
        and o.tier = 'pursue'
        and coalesce(o.pursuit_state, 'active') = 'active'
        and o.is_sources_sought is not true
        and o.solicitation_analysis is not null
        and coalesce(o.human_action_required, false) is not true
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
        and (
          (coalesce(finder.finished, false) is not true and coalesce(finder.attempts, 0) >= ${HANDOFF_ATTEMPT_CAP})
          or (coalesce(pricing.finished, false) is not true and coalesce(pricing.attempts, 0) >= ${HANDOFF_ATTEMPT_CAP})
        )
      limit 20`,
    [orgId, rules.work_execution]
  );
  for (const row of sourceCapped) {
    await consider(orgId, result, parked, inFlight, now, "sub-finder", row.id, "", "", { opportunityId: row.id }, `sub-finder:${row.id}`, { finished: false, attempts: HANDOFF_ATTEMPT_CAP, lastAttemptAt: null });
  }
  const sources = await query<QueryResultRow>(
    `-- pursue-source-candidates
     select o.id,
            coalesce(finder.finished, false) as finder_finished,
            coalesce(finder.attempts, 0) as finder_attempts,
            finder.last_at as finder_last_attempt_at,
            coalesce(pricing.finished, false) as pricing_finished,
            coalesce(pricing.attempts, 0) as pricing_attempts,
            pricing.last_at as pricing_last_attempt_at
       from opportunities o
       left join lateral (
         select bool_or(j.status in ('ok', 'skipped')) as finished,
                count(*) filter (
                  where j.status = 'error'
                     or (j.status = 'running' and j.started_at <= now() - interval '30 minutes')
                )::int as attempts,
                max(j.started_at) filter (
                  where j.status = 'error'
                     or (j.status = 'running' and j.started_at <= now() - interval '30 minutes')
                ) as last_at
           from job_runs j
          where j.org_id = o.org_id and j.opportunity_id = o.id and j.agent = 'sub-finder'
       ) finder on true
       left join lateral (
         select bool_or(j.status in ('ok', 'skipped')) as finished,
                count(*) filter (
                  where j.status = 'error'
                     or (j.status = 'running' and j.started_at <= now() - interval '30 minutes')
                )::int as attempts,
                max(j.started_at) filter (
                  where j.status = 'error'
                     or (j.status = 'running' and j.started_at <= now() - interval '30 minutes')
                ) as last_at
           from job_runs j
          where j.org_id = o.org_id and j.opportunity_id = o.id and j.agent = 'pricing-research'
       ) pricing on true
      where o.org_id = $1
        and o.status = 'open'
        and o.tier = 'pursue'
        and coalesce(o.pursuit_state, 'active') = 'active'
        and o.is_sources_sought is not true
        and o.solicitation_analysis is not null
        and coalesce(o.human_action_required, false) is not true
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
        and (
          coalesce(finder.finished, false) is not true
          or coalesce(pricing.finished, false) is not true
        )
      order by least(coalesce(finder.attempts, 0), coalesce(pricing.attempts, 0)) asc,
               o.created_at desc
      limit 50`,
    [orgId, rules.work_execution]
  );
  for (const row of sources) {
    const id = String(row.id);
    const priced = await consider(orgId, result, parked, inFlight, now, "pricing-research", id, "", "", { opportunityId: id }, `pricing-research:${id}`, readFacts(row, "pricing"));
    const sourced = await consider(orgId, result, parked, inFlight, now, "sub-finder", id, "", "", { opportunityId: id }, `sub-finder:${id}`, readFacts(row, "finder"));
    if (priced || sourced) result.sourcingQueued += 1;
  }

  const verifies = await query<QueryResultRow>(
    `-- pursue-verify-candidates
     select os.opportunity_id, os.subcontractor_id, coalesce(os.trade, '') as trade,
            coalesce(v.finished, false) as finished,
            coalesce(v.attempts, 0) as attempts,
            v.last_at as last_attempt_at
       from opportunity_subs os
       join opportunities o on o.id = os.opportunity_id and o.org_id = os.org_id
       left join lateral (
         select bool_or(l.status in ('ok', 'skipped')) as finished,
                count(*) filter (where l.status = 'error' and coalesce(l.action, '') <> 'completion-held')::int as attempts,
                max(l.created_at) filter (where l.status = 'error' and coalesce(l.action, '') <> 'completion-held') as last_at
           from agent_logs l
          where l.org_id = os.org_id
            and l.opportunity_id = os.opportunity_id
            and l.subcontractor_id = os.subcontractor_id
            and l.agent = 'sub-verify'
            and l.action = 'run'
       ) v on true
      where os.org_id = $1
        and o.status = 'open'
        and o.tier = 'pursue'
        and coalesce(o.pursuit_state, 'active') = 'active'
        and o.is_sources_sought is not true
        and coalesce(o.human_action_required, false) is not true
        and os.removed_at is null
        and os.verified is not true
        and os.outreach_state in ('pending', 'draft')
        and coalesce(v.finished, false) is not true
        and coalesce(v.attempts, 0) < ${HANDOFF_ATTEMPT_CAP}
        and (
          v.last_at is null
          or (v.attempts <= 1 and v.last_at < now() - interval '10 minutes')
          or (v.attempts = 2 and v.last_at < now() - interval '30 minutes')
        )
        and ${outreachSql}
      order by coalesce(v.attempts, 0) asc, v.last_at asc nulls first, os.created_at desc
      limit 50`,
    [orgId, rules.work_execution]
  );
  const verifyCapped = await query<QueryResultRow>(
    `-- pursue-verify-capped
     select os.opportunity_id, os.subcontractor_id, coalesce(os.trade, '') as trade,
            false as finished, coalesce(v.attempts, 0) as attempts, v.last_at as last_attempt_at
       from opportunity_subs os
       join opportunities o on o.id = os.opportunity_id and o.org_id = os.org_id
       left join lateral (
         select count(*) filter (where l.status = 'error' and coalesce(l.action, '') <> 'completion-held')::int as attempts,
                max(l.created_at) filter (where l.status = 'error' and coalesce(l.action, '') <> 'completion-held') as last_at,
                bool_or(l.status in ('ok', 'skipped')) as finished
           from agent_logs l
          where l.org_id = os.org_id
            and l.opportunity_id = os.opportunity_id
            and l.subcontractor_id = os.subcontractor_id
            and l.agent = 'sub-verify'
            and l.action = 'run'
       ) v on true
      where os.org_id = $1
        and o.status = 'open'
        and o.tier = 'pursue'
        and coalesce(o.pursuit_state, 'active') = 'active'
        and coalesce(o.human_action_required, false) is not true
        and os.removed_at is null
        and os.verified is not true
        and os.outreach_state in ('pending', 'draft')
        and coalesce(v.finished, false) is not true
        and coalesce(v.attempts, 0) >= ${HANDOFF_ATTEMPT_CAP}
        and ${outreachSql}
      limit 20`,
    [orgId, rules.work_execution]
  );
  for (const row of verifyCapped) {
    await considerPair(orgId, result, parked, inFlight, now, "sub-verify", row);
  }
  for (const row of verifies) {
    const queued = await considerPair(orgId, result, parked, inFlight, now, "sub-verify", row);
    if (queued) result.verifyQueued += 1;
  }

  if (rules.rfq_outbound_enabled) {
    const sends = await query<QueryResultRow>(
      `-- pursue-outreach-candidates
       select os.opportunity_id, os.subcontractor_id, coalesce(os.trade, '') as trade,
              coalesce(v.finished, false) as finished,
              coalesce(v.attempts, 0) as attempts,
              v.last_at as last_attempt_at
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id and o.org_id = $1
         join subcontractors s on s.id = os.subcontractor_id and s.org_id = $1
         left join lateral (
           select bool_or(l.status in ('ok', 'skipped')) as finished,
                  count(*) filter (where l.status = 'error' and coalesce(l.action, '') <> 'completion-held')::int as attempts,
                  max(l.created_at) filter (where l.status = 'error' and coalesce(l.action, '') <> 'completion-held') as last_at
             from agent_logs l
            where l.org_id = os.org_id
              and l.opportunity_id = os.opportunity_id
              and l.subcontractor_id = os.subcontractor_id
              and l.agent = 'outreach'
              and l.action = 'run'
         ) v on true
        where os.org_id = $1
          and o.status = 'open'
          and o.tier = 'pursue'
          and coalesce(o.pursuit_state, 'active') = 'active'
          and o.is_sources_sought is not true
          and coalesce(o.human_action_required, false) is not true
          and os.removed_at is null
          and os.verified is true
          and s.email_verified is true
          and nullif(btrim(coalesce(s.email, '')), '') is not null
          and os.outreach_state in ('pending', 'draft')
          and coalesce(v.finished, false) is not true
          and coalesce(v.attempts, 0) < ${HANDOFF_ATTEMPT_CAP}
          and (
            v.last_at is null
            or (v.attempts <= 1 and v.last_at < now() - interval '10 minutes')
            or (v.attempts = 2 and v.last_at < now() - interval '30 minutes')
          )
          and not exists (
            select 1 from communications c
             where c.org_id = os.org_id
               and c.opportunity_id = os.opportunity_id
               and c.subcontractor_id = os.subcontractor_id
               and c.channel = 'email'
               and c.direction = 'outbound'
               and (
                 (c.provider is not null and c.delivery_state in ('sent', 'delivered', 'bounced', 'deferred'))
                 or c.delivery_state in ('queued', 'attempting', 'unknown')
               )
               and coalesce(c.meta->>'trade', '') = coalesce(os.trade, '')
               and coalesce(c.meta->>'kind', '') not in ('decline_thank_you', 'final_nudge', 'clarification', 'compliance-chase')
          )
          and ${outreachSql}
        order by coalesce(v.attempts, 0) asc, v.last_at asc nulls first, os.created_at desc
        limit 50`,
      [orgId, rules.work_execution]
    );
    const outreachCapped = await query<QueryResultRow>(
      `-- pursue-outreach-capped
       select os.opportunity_id, os.subcontractor_id, coalesce(os.trade, '') as trade
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id and o.org_id = $1
         join subcontractors s on s.id = os.subcontractor_id and s.org_id = $1
         left join lateral (
           select bool_or(l.status in ('ok', 'skipped')) as finished,
                  count(*) filter (where l.status = 'error' and coalesce(l.action, '') <> 'completion-held')::int as attempts
             from agent_logs l
            where l.org_id = os.org_id
              and l.opportunity_id = os.opportunity_id
              and l.subcontractor_id = os.subcontractor_id
              and l.agent = 'outreach'
              and l.action = 'run'
         ) v on true
        where os.org_id = $1
          and o.status = 'open'
          and o.tier = 'pursue'
          and coalesce(o.pursuit_state, 'active') = 'active'
          and coalesce(o.human_action_required, false) is not true
          and os.removed_at is null
          and os.verified is true
          and s.email_verified is true
          and nullif(btrim(coalesce(s.email, '')), '') is not null
          and os.outreach_state in ('pending', 'draft')
          and coalesce(v.finished, false) is not true
          and coalesce(v.attempts, 0) >= ${HANDOFF_ATTEMPT_CAP}
          and ${outreachSql}
        limit 20`,
      [orgId, rules.work_execution]
    );
    for (const row of outreachCapped) {
      await considerPair(orgId, result, parked, inFlight, now, "outreach", { ...row, attempts: HANDOFF_ATTEMPT_CAP, finished: false });
    }
    for (const row of sends) {
      const queued = await considerPair(orgId, result, parked, inFlight, now, "outreach", row);
      if (queued) result.outreachQueued += 1;
    }
  }

  if (parked.fresh.length > 0) {
    result.parked += parked.fresh.length;
    const text =
      `These items reached the retry cap and were parked for a person: ${parked.fresh.join(", ")}. ` +
      "The continuation sweep will not queue another paid lookup for them.";
    await deliverOutageAlert({ subject: "A pursue step needs a person", text });
    await logAgent({
      agent: SWEEP_AGENT,
      action: "handoff-cap",
      level: "warn",
      message: text,
    });
  }

  const watched = await watchPipeline(orgId, rules.rfq_outbound_enabled);
  result.alerted += watched.alerted;
  result.resolved += watched.resolved;

  const moved = result.bandQueued + result.sourcingQueued + result.verifyQueued + result.outreachQueued;
  if (moved > 0) {
    await logAgent({
      agent: SWEEP_AGENT,
      action: "requeue-pursuit",
      level: "info",
      message:
        `Queued ${result.bandQueued} band decision(s), ${result.sourcingQueued} sourcing job(s), ` +
        `${result.verifyQueued} verification(s), and ${result.outreachQueued} quote request(s) ` +
        "for pursue work whose next step never started or was interrupted.",
    });
  }
  return result;
}

function readFacts(row: QueryResultRow, prefix = ""): AttemptFacts {
  const finished = prefix ? row[`${prefix}_finished`] : row.finished;
  const attempts = prefix ? row[`${prefix}_attempts`] : row.attempts;
  const last = prefix ? row[`${prefix}_last_attempt_at`] : row.last_attempt_at;
  const count = Number(attempts ?? 0);
  return {
    finished: finished === true || finished === "t",
    attempts: Number.isFinite(count) ? count : 0,
    lastAttemptAt: last ? new Date(String(last)) : null,
  };
}

async function considerPair(
  orgId: string,
  result: PursuitGapResult,
  parked: Parked,
  inFlight: Set<string>,
  now: Date,
  agent: string,
  row: QueryResultRow
): Promise<boolean> {
  const opportunityId = String(row.opportunity_id);
  const subcontractorId = String(row.subcontractor_id ?? "");
  const trade = String(row.trade ?? "");
  const singleton = agent === "outreach"
    ? `rfq:${opportunityId}:${subcontractorId}:${trade}`
    : `verify:${opportunityId}:${subcontractorId}:${trade}`;
  return consider(
    orgId,
    result,
    parked,
    inFlight,
    now,
    agent,
    opportunityId,
    subcontractorId,
    trade,
    { opportunityId, subcontractorId, trade },
    singleton,
    readFacts(row)
  );
}

async function consider(
  orgId: string,
  result: PursuitGapResult,
  parked: Parked,
  inFlight: Set<string>,
  now: Date,
  agent: string,
  opportunityId: string,
  subcontractorId: string,
  trade: string,
  payload: Record<string, unknown>,
  singletonKey: string,
  facts: AttemptFacts
): Promise<boolean> {
  if (parked.ids.has(opportunityId)) return false;
  const key = handoffKey(agent, opportunityId, subcontractorId, trade);
  const decision = handoffAdmission({
    finished: facts.finished,
    attempts: facts.attempts,
    lastAttemptAt: facts.lastAttemptAt,
    inFlight: inFlight.has(key) || inFlight.has(`${agent}:${opportunityId}:*`),
    now,
    interrupted: facts.attempts > 0 && !facts.finished,
  });
  if (decision === "cap") {
    await parkItem(orgId, opportunityId, parked);
    return false;
  }
  if (decision !== "queue") return false;
  const queued = await tryQueue(orgId, result, agent, payload, singletonKey, SINGLETON_SECONDS);
  if (queued) inFlight.add(key);
  return queued;
}

async function parkItem(orgId: string, opportunityId: string, parked: Parked): Promise<void> {
  if (parked.ids.has(opportunityId)) return;
  parked.ids.add(opportunityId);
  const rows = await query<{ id: string }>(
    `-- park-human-action
     update opportunities
        set human_action_required = true
      where id = $1 and org_id = $2 and human_action_required is not true
      returning id`,
    [opportunityId, orgId]
  );
  if (rows[0]) parked.fresh.push(opportunityId);
}

async function loadInFlight(orgId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const running = await query<{ agent: string; opportunity_id: string }>(
    `-- handoff-in-flight
     select agent, opportunity_id::text as opportunity_id
       from job_runs
      where org_id = $1
        and status = 'running'
        and started_at > now() - interval '30 minutes'
        and agent in ('scoring-engine', 'pricing-research', 'sub-finder', 'sub-verify', 'outreach')
        and opportunity_id is not null`,
    [orgId]
  );
  for (const row of running) {
    if (row.agent === "sub-verify" || row.agent === "outreach") {
      keys.add(`${row.agent}:${row.opportunity_id}:*`);
    } else {
      keys.add(handoffKey(row.agent, row.opportunity_id));
    }
  }
  const reg = await queryOne<{ job: string | null }>(`select to_regclass('pgboss.job')::text as job`);
  if (!reg?.job) return keys;
  const queued = await query<{
    agent: string;
    opportunity_id: string;
    subcontractor_id: string | null;
    trade: string | null;
  }>(
    `-- handoff-queued
     select name as agent,
            data->>'opportunityId' as opportunity_id,
            data->>'subcontractorId' as subcontractor_id,
            data->>'trade' as trade
       from pgboss.job
      where state in ('created', 'retry', 'active')
        and name in ('scoring-engine', 'pricing-research', 'sub-finder', 'sub-verify', 'outreach')
        and data->>'enqueuedByOrgId' = $1
        and coalesce(data->>'opportunityId', '') <> ''`,
    [orgId]
  );
  for (const row of queued) {
    keys.add(handoffKey(row.agent, row.opportunity_id, row.subcontractor_id ?? "", row.trade ?? ""));
  }
  return keys;
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
      agent: SWEEP_AGENT,
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
  const incident = await queryOne<{
    id: string;
    state: string | null;
    start_alert_at: string | null;
    end_alert_at: string | null;
  }>(
    `-- pipeline-stall-incident
     select id, state, start_alert_at, end_alert_at
       from automation_incidents
      where org_id = $1 and cause = $2
      order by created_at desc
      limit 1`,
    [orgId, PIPELINE_STALL_CAUSE]
  );
  const open = incident && incident.state !== "recovered" && incident.state !== "retired" ? incident : null;
  const decision = pipelineStallDecision({
    eligible: pipelineStallEligible(counts),
    incidentOpen: Boolean(open),
    lastAlertAt: latestAlert(incident?.start_alert_at, incident?.end_alert_at),
    now: new Date(),
  });
  if (decision === "quiet") return { alerted: 0, resolved: 0 };
  if (decision === "alert") {
    const created = open ?? (await openOrUpdateIncident({
      orgId,
      cause: PIPELINE_STALL_CAUSE,
      severity: "blocking",
      startedAt: new Date(),
      detectionSource: "pursuit_continuation_sweep",
      failedCount: 1,
      recommendedAction: "The continuation sweep queues a missing band decision, verification, or quote request. Confirm the next run moves one of those rows.",
    }));
    if (!(await claimAlert(orgId, created.id, "start"))) return { alerted: 0, resolved: 0 };
    const text = pipelineStallText(counts);
    await deliverOutageAlert({ subject: "Pursue work is waiting", text });
    await logAgent({
      agent: SWEEP_AGENT,
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

function latestAlert(start: string | null | undefined, end: string | null | undefined): Date | null {
  const times = [start, end]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (times.length === 0) return null;
  return new Date(Math.max(...times));
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
           and coalesce(o.human_action_required, false) is not true
           and o.updated_at < now() - ($2::text || ' hours')::interval) as undecided_band,
       (select count(*)::int from agent_logs l
         where l.org_id = $1 and l.agent = 'scoring-engine' and l.action = 'band-decision'
           and l.created_at > now() - ($2::text || ' hours')::interval) as band_decisions,
       (select count(*)::int from opportunities o
         where o.org_id = $1 and o.status = 'open' and o.tier = 'pursue'
           and coalesce(o.pursuit_state, 'active') = 'active'
           and o.solicitation_analysis is not null
           and o.is_sources_sought is not true
           and coalesce(o.human_action_required, false) is not true
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
           and coalesce(o.human_action_required, false) is not true
           and os.removed_at is null and os.verified is not true
           and os.outreach_state in ('pending', 'draft')
           and os.created_at < now() - ($2::text || ' hours')::interval) as unverified,
       (select count(*)::int from job_runs j
         where j.org_id = $1 and j.agent = 'sub-verify'
           and j.started_at > now() - ($2::text || ' hours')::interval) as verify_runs,
       (select count(*)::int from opportunity_subs os
          join opportunities o on o.id = os.opportunity_id and o.org_id = $1
          join subcontractors s on s.id = os.subcontractor_id and s.org_id = $1
         where os.org_id = $1 and o.status = 'open' and o.tier = 'pursue'
           and coalesce(o.pursuit_state, 'active') = 'active'
           and coalesce(o.human_action_required, false) is not true
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
        actor: SWEEP_AGENT,
        detail: step === "recovered" ? note : undefined,
        set: step === "recovered" ? { recoveryNote: note, recoveryOwner: SWEEP_AGENT } : undefined,
      });
    } catch (error) {
      if (!(error instanceof IllegalTransition)) throw error;
    }
  }
}
