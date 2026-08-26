/**
 * Trial Sweep: warn before a trial ends, and close it when it does.
 *
 * The access gates already treat a lapsed trial as expired the moment the date
 * passes, so this sweep is not what enforces the limit. What it does is make
 * the stored state honest, so admin views, filters, and analytics see the same
 * thing the gates do, and give the customer warning before their account
 * locks rather than after.
 *
 * The warning matters more than the flip. Somebody who put a week of setup
 * into this platform and then finds it locked with no notice does not upgrade;
 * they leave, annoyed, and rightly so.
 */
import { query } from "../db";
import { logAgent } from "../logger";
import { systemMail } from "../integrations/system-mail";
import { config } from "../config";
import { TRIAL_STATUS, TRIAL_EXPIRED_STATUS } from "../billing/entitlements";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

/** Days before expiry that earn a warning email. */
const WARN_AT_DAYS = [3, 1] as const;

interface TrialRow {
  id: string;
  name: string;
  trial_ends_at: string | null;
  owner_email: string | null;
  days_left: number;
}

/** Live trials with their owner's address and how long they have left. */
async function loadLiveTrials(): Promise<TrialRow[]> {
  return query<TrialRow>(
    `select o.id, o.name, o.trial_ends_at::text as trial_ends_at,
            (select u.email
               from organization_members m
               join users u on u.id = m.user_id
              where m.org_id = o.id
              order by m.created_at asc
              limit 1) as owner_email,
            ceil(extract(epoch from (o.trial_ends_at - now())) / 86400)::int as days_left
       from organizations o
      where o.subscription_status = $1
        and o.trial_ends_at is not null
        and o.trial_ends_at > now()`,
    [TRIAL_STATUS]
  ).catch(() => []);
}

function warningCopy(org: TrialRow, appUrl: string): { subject: string; text: string } {
  const days = org.days_left;
  const when = days <= 1 ? "tomorrow" : `in ${days} days`;
  return {
    subject:
      days <= 1
        ? "Your Brost Co trial ends tomorrow"
        : `Your Brost Co trial ends in ${days} days`,
    text: [
      `Your free trial of Brost Co ends ${when}.`,
      "",
      "Everything you have set up stays exactly as it is: your company profile, the opportunities found for you, your subcontractors, and any quotes already received. Choosing a plan lifts the trial limits and keeps the automation running.",
      "",
      `Choose a plan: ${appUrl.replace(/\/+$/, "")}/settings/billing`,
      "",
      "If Brost Co is not the right fit, you do not need to do anything. Nothing has been charged and no card is on file.",
      "",
      "Brost Co",
    ].join("\n"),
  };
}

export const trialSweep: AgentDefinition = {
  name: "trial-sweep",
  label: "Trial Sweep",
  description:
    "Warns trial customers three days and one day before their free trial ends, then closes the trial when the window passes so access follows billing.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const appUrl = config.appUrl;

    // 1. Close trials whose window has passed.
    /*
     * A failure here used to become an empty list, so the summary said "0
     * closed" whether the flip had happened or the statement had thrown.
     *
     * The customer is not let in by this: the access gates read `trial_ends_at`
     * directly and lock the account the moment the date passes, which is why
     * this sweep is not the thing enforcing the limit. What breaks is that the
     * stored status keeps saying `trial` while the gates behave as expired, so
     * the admin views, the filters and the analytics that read the column all
     * disagree with what the customer is experiencing, and nothing anywhere
     * says which of the two is wrong.
     */
    let expired: { id: string; name: string }[];
    let expiryError: string | null = null;
    try {
      expired = await query<{ id: string; name: string }>(
        `update organizations
            set subscription_status = $2, updated_at = now()
          where subscription_status = $1
            and trial_ends_at is not null
            and trial_ends_at <= now()
          returning id, name`,
        [TRIAL_STATUS, TRIAL_EXPIRED_STATUS]
      );
    } catch (err) {
      expired = [];
      expiryError = (err as Error).message;
      await logAgent({
        agent: "trial-sweep",
        action: "trial-expiry-failed",
        level: "error",
        status: "error",
        message: `Could not close expired trials: ${expiryError}. Their stored status still says trial while the access gates treat them as expired, so admin views and analytics disagree with what those customers can actually do.`.slice(
          0,
          500
        ),
      });
    }

    for (const org of expired) {
      await logAgent({
        agent: "trial-sweep",
        action: "trial-expired",
        level: "warn",
        message: `${org.name}'s free trial ended without an upgrade. Their account is locked until they choose a plan; nothing has been deleted.`,
      });
    }

    // 2. Warn the trials that are close, once per threshold.
    const live = await loadLiveTrials();
    let warned = 0;
    const mailReady = await systemMail.enabled().catch(() => false);

    for (const org of live) {
      if (!WARN_AT_DAYS.includes(org.days_left as (typeof WARN_AT_DAYS)[number])) continue;

      // One warning per org per threshold. The marker is an agent_logs row,
      // so a sweep that runs hourly does not email the same person hourly.
      const already = await query<{ n: number }>(
        `select count(*)::int as n from agent_logs
          where agent = 'trial-sweep'
            and action = $1
            and message like $2
            and created_at > now() - interval '36 hours'`,
        [`trial-warning-${org.days_left}d`, `%${org.id}%`]
        // A failed lookup counts as "already warned" and skips this org for
        // this sweep. Erring toward silence is right here: the alternative is
        // emailing the same customer on every run of a sweep that runs hourly,
        // and the next sweep retries anyway.
      ).catch(() => [{ n: 1 }]);
      if ((already[0]?.n ?? 0) > 0) continue;

      /*
       * Whether the warning actually went.
       *
       * The send swallowed its error and the log said "Warned {email}"
       * regardless, so a mail outage produced a record of a warning nobody
       * received. Worse, that log row IS the dedupe marker, so the customer
       * was never warned at that threshold again: one transient failure
       * permanently lost somebody's three-day notice, and the audit trail
       * said they had been told.
       */
      let sendError: string | null = null;
      if (org.owner_email && mailReady) {
        const copy = warningCopy(org, appUrl);
        try {
          await systemMail.send({ to: org.owner_email, subject: copy.subject, text: copy.text });
        } catch (err) {
          sendError = (err as Error).message;
        }
      }
      const sent = Boolean(org.owner_email && mailReady && !sendError);
      await logAgent({
        agent: "trial-sweep",
        /*
         * A failed send is logged under a different action on purpose. The
         * dedupe above matches on `action = trial-warning-Nd`, so writing that
         * action would suppress the retry; this way the next sweep tries
         * again while the threshold is still in the past.
         */
        action: sent ? `trial-warning-${org.days_left}d` : `trial-warning-${org.days_left}d-unsent`,
        level: sent ? "info" : "warn",
        status: sent ? "ok" : "error",
        message: `${org.name} (${org.id}) has ${org.days_left} day${org.days_left === 1 ? "" : "s"} of trial left. ${
          sent
            ? `Warned ${org.owner_email}.`
            : sendError
              ? `The warning email to ${org.owner_email} failed: ${sendError}. It will be tried again on the next sweep.`
              : "No warning email could be sent: no owner address on file, or outbound mail is not configured."
        }`.slice(0, 500),
      });
      if (sent) warned++;
    }

    return {
      ok: expiryError == null,
      summary: expiryError
        ? `${live.length} trial(s) running, ${warned} warned. Expired trials could NOT be marked closed, so their stored status disagrees with the access they actually have: ${expiryError}`.slice(
            0,
            500
          )
        : `${live.length} trial${live.length === 1 ? "" : "s"} running, ${warned} warned, ${expired.length} closed.`,
      // A trial closing is a sales event, not an operations failure. Nobody
      // needs to be paged; it belongs in the log and in the digest.
      humanActionRequired: false,
    };
  },
};
