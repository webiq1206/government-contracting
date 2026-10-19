/**
 * Release holds that outlived their call, then tell the operator.
 *
 * This runs inside the pursuit continuation job, so it shares that job's
 * pg-boss singleton. It does not call a model, send vendor mail, or enqueue
 * scoring. A finished 50-69 score is handed to the continuation backfill,
 * which already caps attempts. A work receipt inside its lease still refuses
 * a second bill for an attempt that may be in flight; one past its lease is
 * handed back to the schedule, and the Sent folder settles mail whose
 * outcome was lost.
 */
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { LEGACY_ORG_ID, runWithOrg } from "../tenant-context";
import { deliverOutageAlert } from "../outage-alert";
import { advance, IllegalTransition, openOrUpdateIncident } from "../incidents";
import {
  countUnresolvedScheduledMail,
  reclaimStaleProviderAttempts,
  sweepMail,
  type HoldSweepResult,
} from "../domain/hold-sweep";
import { sweepActed, latchAlertDecision } from "../domain/hold-registry";
import { reconcileUncertainScheduledMail } from "../scheduled-mail-reconcile";

const UNRESOLVED_MAIL_CAUSE = "unresolved_scheduled_mail";

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
        "The mailbox could not be read to settle these sends. Reconnect or wait for its quota; the next sweep settles them against Gmail Sent.",
    });
    if (!(await claimAlert(LEGACY_ORG_ID, opened.id, "start"))) return { alerts: 0, clears: 0 };
    await deliverOutageAlert({
      subject: "BrostCo has scheduled mail waiting on review",
      text: `${count} scheduled message(s) are still attempting or unknown after the send lease because the mailbox could not be read. The sweep settles them against Gmail Sent as soon as it can.`,
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

async function incidentOpen(orgId: string, cause: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select id from automation_incidents
      where org_id = $1 and cause = $2 and state <> 'recovered'
      limit 1`,
    [orgId, cause]
  );
  return Boolean(row);
}

export async function runHoldSweepCycle(): Promise<HoldSweepResult> {
  const result = await reclaimStaleProviderAttempts();
  // Sends whose outcome was never written are settled against the mailbox's
  // own Sent folder: what left is recorded as sent, what did not is handed
  // back to the next outreach run. Nothing is sent from here. A mailbox that
  // cannot be read leaves its rows for the next sweep and the alert below.
  if (result.unresolvedScheduledMail > 0) {
    try {
      const reconciled = await reconcileUncertainScheduledMail();
      result.confirmedSentMail = reconciled.confirmedSent;
      result.releasedUncertainMail = reconciled.releasedForRetry;
      result.unresolvedScheduledMail = await countUnresolvedScheduledMail();
    } catch (error) {
      console.error(
        "[hold-sweep] scheduled mail reconciliation failed:",
        error instanceof Error ? error.message : error
      );
    }
  }
  const mailWatch = await runWithOrg(LEGACY_ORG_ID, () =>
    watchUnresolvedMail(result.unresolvedScheduledMail)
  );
  if (mailWatch.alerts > 0 || mailWatch.clears > 0) {
    console.warn(`[hold-sweep] mail alerts ${mailWatch.alerts}, cleared ${mailWatch.clears}`);
  }
  if (sweepActed(result) && (await claimSweepMail())) {
    const mail = sweepMail(result);
    await deliverOutageAlert({ subject: mail.subject, text: mail.text });
    await logAgent({
      agent: "hold-sweep",
      action: "released",
      level: "warn",
      message: mail.text,
      output: result,
    });
  }
  return result;
}
