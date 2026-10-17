/**
 * Every 10 minutes, release holds that outlived their call and tell the
 * operator when scoring, band decisions, or quote requests are sitting still.
 *
 * The sweep does not call a model and does not send vendor mail. Re-queued
 * scoring uses the same singleton key as a normal score, and a pending work
 * receipt still refuses a second bill for the attempt that was abandoned.
 */
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { enqueue } from "../queue";
import { LEGACY_ORG_ID, runWithOrg } from "../tenant-context";
import { getAutomationRules } from "../app-settings";
import { deliverOutageAlert } from "../outage-alert";
import { advance, IllegalTransition, openOrUpdateIncident } from "../incidents";
import { addBusinessDays } from "../domain/review-lead";
import { orgsToSweep } from "./org-fanout";
import { reclaimStaleProviderAttempts, sweepMail, type HoldSweepResult } from "../domain/hold-sweep";
import { sweepActed, latchAlertDecision } from "../domain/hold-registry";
import {
  PIPELINE_STALL_CAUSE,
  PIPELINE_STALL_HOURS,
  pipelineStallActions,
  pipelineStallText,
  type PipelineStallKind,
} from "../domain/pipeline-watch";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

const UNRESOLVED_MAIL_CAUSE = "unresolved_scheduled_mail";
let busy = false;

async function claimSweepMail(): Promise<boolean> {
  const rows = await query<{ name: string }>(
    `insert into api_usage_job_leases(name, expires_at)
     values('hold-sweep-mail', now() + interval '9 minutes')
     on conflict(name) do update set expires_at = excluded.expires_at
     where api_usage_job_leases.expires_at < now()
     returning name`
  );
  return rows.length > 0;
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
  for (const step of ["mitigating", "provider_restored", "test_passed", "recovered"] as const) {
    try {
      await advance({
        incidentId,
        orgId,
        to: step,
        actor: "hold-sweep",
        detail: step === "recovered" ? note : undefined,
        set:
          step === "test_passed"
            ? { testRanAt: new Date(), testPassed: true, testDetail: note }
            : step === "recovered"
              ? { recoveryNote: note, recoveryOwner: "hold-sweep", testPassed: true }
              : undefined,
      });
    } catch (error) {
      if (!(error instanceof IllegalTransition)) throw error;
    }
  }
}

async function requeueAffected(orgId: string, leadCutoff: Date): Promise<number> {
  const rows = await query<{ id: string; agent: "scoring-engine" | "solicitation-analyst" }>(
    `select id, 'scoring-engine' as agent
       from opportunities
      where org_id = $1
        and status = 'open'
        and tier = 'review'
        and stage in ('monitoring', 'scoring')
        and deadline is not null
        and deadline >= $2
        and (
          'incomplete_scoring' = any(coalesce(risk_flags, '{}'))
          or (score >= 50 and score <= 69 and band_decision is null)
        )
     union
     select id, 'solicitation-analyst' as agent
       from opportunities
      where org_id = $1
        and status = 'open'
        and stage = 'analysis'
        and solicitation_analysis is null
        and deadline is not null
        and deadline >= $2`,
    [orgId, leadCutoff.toISOString()]
  );
  let queued = 0;
  for (const row of rows) {
    const key = row.agent === "scoring-engine" ? `score:${row.id}` : `analyze:${row.id}`;
    const id = await enqueue(
      row.agent,
      { opportunityId: row.id, trigger: "hold-sweep" },
      { orgId, singletonKey: key, singletonSeconds: 3600 }
    );
    if (id) queued += 1;
  }
  return queued;
}

async function countsFor(orgId: string, leadCutoff: Date): Promise<{
  scoring: number;
  band: number;
  rfq: number;
}> {
  const scoringHours = PIPELINE_STALL_HOURS.scoring;
  const rfqHours = PIPELINE_STALL_HOURS.rfq;
  const row = await queryOne<{ scoring: number; band: number; rfq: number }>(
    `select
       (select count(*)::int from opportunities o
         where o.org_id = $1 and o.status = 'open'
           and o.stage in ('monitoring', 'scoring')
           and o.score is null
           and o.deadline is not null and o.deadline >= $2
           and o.created_at <= now() - ($3::int * interval '1 hour')) as scoring,
       (select count(*)::int from opportunities o
         where o.org_id = $1 and o.status = 'open'
           and o.tier = 'review'
           and o.band_decision is null
           and o.score >= 50 and o.score <= 69
           and o.deadline is not null and o.deadline >= $2
           and o.updated_at <= now() - ($3::int * interval '1 hour')) as band,
       (select count(*)::int from opportunities o
         where o.org_id = $1 and o.status = 'open'
           and o.tier = 'pursue'
           and o.stage in ('analysis', 'sub_research', 'outreach')
           and o.deadline is not null and o.deadline >= $2
           and o.updated_at <= now() - ($4::int * interval '1 hour')
           and not exists (
             select 1 from communications c
              where c.org_id = o.org_id
                and c.opportunity_id = o.id
                and c.channel = 'email' and c.direction = 'outbound'
                and c.delivery_state in ('sent', 'delivered')
           )) as rfq`,
    [orgId, leadCutoff.toISOString(), scoringHours, rfqHours]
  );
  return {
    scoring: Number(row?.scoring ?? 0),
    band: Number(row?.band ?? 0),
    rfq: Number(row?.rfq ?? 0),
  };
}

async function incidentOpen(orgId: string, cause: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select id from automation_incidents
      where org_id = $1 and cause = $2 and state <> 'recovered'
      limit 1`,
    [orgId, cause]
  );
  return Boolean(row);
}

async function watchOrg(orgId: string): Promise<{ alerts: number; clears: number }> {
  const rules = await getAutomationRules();
  const leadCutoff =
    rules.min_bid_lead_business_days > 0
      ? addBusinessDays(new Date(), rules.min_bid_lead_business_days)
      : new Date(Date.now() + 24 * 60 * 60_000);
  const counts = await countsFor(orgId, leadCutoff);
  const actions = pipelineStallActions({
    scoringEligible: counts.scoring,
    bandEligible: counts.band,
    rfqEligible: counts.rfq,
    scoringIncidentOpen: await incidentOpen(orgId, PIPELINE_STALL_CAUSE.scoring),
    bandIncidentOpen: await incidentOpen(orgId, PIPELINE_STALL_CAUSE.band),
    rfqIncidentOpen: await incidentOpen(orgId, PIPELINE_STALL_CAUSE.rfq),
  });
  let alerts = 0;
  let clears = 0;
  for (const action of actions) {
    const moved = await applyStall(orgId, action.kind, action.action, counts[action.kind]);
    if (action.action === "alert" && moved) alerts += 1;
    if (action.action === "resolve" && moved) clears += 1;
  }
  return { alerts, clears };
}

async function watchUnresolvedMail(count: number): Promise<{ alerts: number; clears: number }> {
  const decision = latchAlertDecision(count, await incidentOpen(LEGACY_ORG_ID, UNRESOLVED_MAIL_CAUSE));
  if (decision === "alert") {
    const opened = await openOrUpdateIncident({
      orgId: LEGACY_ORG_ID,
      cause: UNRESOLVED_MAIL_CAUSE,
      severity: "blocking",
      startedAt: new Date(),
      detectionSource: "hold_sweep",
      failedCount: count,
      recommendedAction:
        "Review the queued or attempting scheduled messages and Gmail Sent. They will not be sent again automatically.",
    });
    if (!(await claimAlert(LEGACY_ORG_ID, opened.id, "start"))) return { alerts: 0, clears: 0 };
    await deliverOutageAlert({
      subject: "BrostCo has scheduled mail waiting on review",
      text: `${count} scheduled message(s) are still queued, attempting, or unknown after the send lease. They were not retried.`,
    });
    return { alerts: 1, clears: 0 };
  }
  if (decision === "resolve") {
    const open = await queryOne<{ id: string }>(
      `select id from automation_incidents
        where org_id = $1 and cause = $2 and state <> 'recovered'
        limit 1`,
      [LEGACY_ORG_ID, UNRESOLVED_MAIL_CAUSE]
    );
    if (!open || !(await claimAlert(LEGACY_ORG_ID, open.id, "end"))) return { alerts: 0, clears: 0 };
    await markRecovered(LEGACY_ORG_ID, open.id, "No scheduled mail claim is still unresolved.");
    return { alerts: 0, clears: 1 };
  }
  return { alerts: 0, clears: 0 };
}

async function applyStall(
  orgId: string,
  kind: PipelineStallKind,
  action: "alert" | "resolve",
  count: number
): Promise<boolean> {
  const cause = PIPELINE_STALL_CAUSE[kind];
  if (action === "alert") {
    const opened = await openOrUpdateIncident({
      orgId,
      cause,
      severity: "blocking",
      startedAt: new Date(),
      detectionSource: "pipeline_watch",
      failedCount: count,
      recommendedAction: pipelineStallText(kind, count),
    });
    if (!(await claimAlert(orgId, opened.id, "start"))) return false;
    await deliverOutageAlert({
      subject: `BrostCo ${kind} is stalled`,
      text: pipelineStallText(kind, count),
    });
    await logAgent({
      agent: "hold-sweep",
      action: "pipeline-stall",
      level: "warn",
      message: pipelineStallText(kind, count),
    });
    return true;
  }
  const open = await queryOne<{ id: string }>(
    `select id from automation_incidents
      where org_id = $1 and cause = $2 and state <> 'recovered'
      limit 1`,
    [orgId, cause]
  );
  if (!open || !(await claimAlert(orgId, open.id, "end"))) return false;
  const note = `The ${kind} stall cleared.`;
  await markRecovered(orgId, open.id, note);
  await deliverOutageAlert({ subject: `BrostCo ${kind} is moving again`, text: note });
  return true;
}

export async function runHoldSweepCycle(): Promise<HoldSweepResult | null> {
  if (busy) return null;
  busy = true;
  try {
    const result = await reclaimStaleProviderAttempts();
    let requeued = 0;
    let alerts = 0;
    let clears = 0;
    const fanout = await orgsToSweep("hold-sweep");
    if (!fanout.error && result.reclaimedAttempts.length > 0) {
      for (const org of fanout.orgs) {
        requeued += await runWithOrg(org.id, async () => {
          const rules = await getAutomationRules();
          const leadCutoff =
            rules.min_bid_lead_business_days > 0
              ? addBusinessDays(new Date(), rules.min_bid_lead_business_days)
              : new Date(Date.now() + 24 * 60 * 60_000);
          return requeueAffected(org.id, leadCutoff);
        });
      }
    }
    if (!fanout.error) {
      for (const org of fanout.orgs) {
        const watched = await runWithOrg(org.id, () => watchOrg(org.id));
        alerts += watched.alerts;
        clears += watched.clears;
      }
    }
    const mailWatch = await runWithOrg(LEGACY_ORG_ID, () =>
      watchUnresolvedMail(result.unresolvedScheduledMail)
    );
    alerts += mailWatch.alerts;
    clears += mailWatch.clears;
    if (alerts > 0 || clears > 0) {
      console.warn(`[hold-sweep] pipeline alerts ${alerts}, cleared ${clears}`);
    }
    if (sweepActed(result) && (await claimSweepMail())) {
      const mail = sweepMail(result);
      const extra = requeued > 0 ? `\nEligible scoring or analysis was queued again: ${requeued}. A pending receipt still blocks a replay.` : "";
      await deliverOutageAlert({ subject: mail.subject, text: mail.text + extra });
      await logAgent({
        agent: "hold-sweep",
        action: "released",
        level: "warn",
        message: mail.text,
        output: result,
      });
    }
    return result;
  } finally {
    busy = false;
  }
}

export const holdSweep: AgentDefinition = {
  name: "hold-sweep",
  label: "Hold sweep",
  description:
    "Releases provider attempts, usage rows, job runs, and other leases that outlived their call, then alerts if scoring, band decisions, or quote requests are stalled.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const result = await runHoldSweepCycle();
    if (!result) return { ok: true, summary: "Hold sweep was already running." };
    const acted = sweepActed(result);
    return {
      ok: true,
      summary: acted
        ? `Hold sweep released ${result.reclaimedAttempts.length} provider attempt(s), settled ${result.settledUsage} usage row(s), and closed ${result.closedRuns} run(s).`
        : "Hold sweep found nothing past its lease.",
      data: { ...result },
    };
  },
};
