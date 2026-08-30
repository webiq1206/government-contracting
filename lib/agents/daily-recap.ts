/**
 * Daily Recap: the morning email, one per recipient, in their own morning.
 *
 * Runs every fifteen minutes rather than once at six, because "six in the
 * morning" is a different instant for every recipient and the worker cannot
 * promise to be awake at any particular one of them. Each tick asks, for each
 * person, whether their own six o'clock has passed and whether anything has
 * been sent for that day yet. The answer to the second question is a row in
 * `recap_deliveries` claimed under a unique index, so a restart mid-run, two
 * workers, or a scheduler firing twice all converge on one email.
 *
 * Three things this deliberately does NOT do:
 *
 *   1. It does not send everything it can as fast as it can. Platform mail
 *      shares one mailbox with password resets, and a hundred recaps fired
 *      into it at once is how somebody locked out at 6:02 waits an hour for a
 *      reset link. There is a per-run cap and a pause between sends; whatever
 *      is left waits for the next tick, fifteen minutes later, still inside
 *      its window.
 *
 *   2. It does not give up on a missed morning. A recap that should have gone
 *      at six and did not is still worth having at nine, so it goes with a
 *      line saying it is late. Past the cutoff it stops: at that point the day
 *      has moved on and tomorrow's recap is the honest one.
 *
 *   3. It does not silently skip a quiet day unless the account asked it to.
 *      An absent email is ambiguous, and the reader cannot tell "nothing
 *      happened" from "the recap is broken".
 */
import { config } from "../config";
import { logAgent } from "../logger";
import { systemMail } from "../integrations/system-mail";
import { LEGACY_ORG_ID, runWithOrg } from "../tenant-context";
import { orgsToSweep, fanoutNote } from "./org-fanout";
import { addLocalDays, recapDue, safeTimeZone } from "../domain/recap/day-window";
import { renderRecapEmail } from "../domain/recap/email";
import { buildRecapFor } from "../recap/build";
import { claimDelivery, markAttempting, markFailed, markSent, markSkipped } from "../recap/delivery";
import { platformRecapRecipients, recapRecipients } from "../recap/recipients";
import { buildPlatformRecap, gatherPlatformFacts } from "../recap/platform";
import { platformAdminEmails } from "../platform-admin";
import { dayWindow } from "../domain/recap/day-window";
import { getRecapSettings } from "../recap/settings";
import { sweepRecapBounces } from "../recap/bounces";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

/**
 * The pacing. Twenty-five sends a tick is a hundred an hour, which clears any
 * plausible customer list well inside the late window while leaving the shared
 * mailbox free for the mail somebody is waiting on.
 */
const MAX_SENDS_PER_RUN = 25;
const PAUSE_BETWEEN_SENDS_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RunTally {
  sent: number;
  skipped: number;
  failed: number;
  deferred: number;
  late: number;
}

export const dailyRecap: AgentDefinition = {
  name: "daily-recap",
  label: "Daily Recap",
  description:
    "Sends each owner and admin a summary of the previous day at their own local send time, with urgent items first, and keeps a record of what was sent.",
  worksWithoutClaude: true,

  async handler(): Promise<AgentResult> {
    const now = new Date();
    const tally: RunTally = { sent: 0, skipped: 0, failed: 0, deferred: 0, late: 0 };
    const notes: string[] = [];

    /*
     * Bounces first, and outside the org loop: it reads the platform's own
     * inbox once, not once per account. Done before sending so an address that
     * died overnight is already marked when this morning's history is written.
     */
    const bounces = await sweepRecapBounces().catch((err) => ({
      scanned: 0,
      matched: 0,
      error: (err as Error).message,
    }));
    if (bounces.error) {
      notes.push(`Could not check for bounced recaps (${bounces.error}).`);
    } else if (bounces.matched > 0) {
      notes.push(`${bounces.matched} recap(s) came back undelivered and are marked in the history.`);
    }

    /*
     * Whether mail can go out at all, asked once. `deliverable()` talks to
     * Google, so asking per recipient would be a hundred round trips to learn
     * the same fact. If it is dead there is nothing to do but say so loudly:
     * claiming delivery rows against a mailbox that cannot send would burn
     * every recipient's slot for the day on failures.
     */
    if (!(await systemMail.enabled())) {
      await logAgent({
        agent: "daily-recap",
        action: "recap-unsent",
        level: "warn",
        status: "error",
        message:
          "No morning recaps went out: the platform inbox is not connected, so nothing could be delivered. Reconnect it in the platform integration settings and the next run will catch up any recipient still inside their window.",
      });
      return {
        ok: false,
        summary: "Platform inbox is not connected, so no recaps were sent.",
        humanActionRequired: true,
      };
    }

    const fanout = await orgsToSweep("daily-recap");
    const fanoutProblem = fanoutNote(fanout);
    if (fanoutProblem) notes.push(fanoutProblem);

    let budget = MAX_SENDS_PER_RUN;

    for (const org of fanout.orgs) {
      if (budget <= 0) break;

      const spent = await runWithOrg(org.id, () =>
        sendForOrg(org.id, now, budget, tally)
      ).catch(async (err) => {
        /*
         * One account's failure must not end the run. The next account's
         * owner has no stake in this one's broken data, and a throw here would
         * mean the first bad row silences everybody after it in the list.
         */
        await logAgent({
          agent: "daily-recap",
          action: "recap-org-failed",
          level: "error",
          status: "error",
          message: `Recap run failed for one account: ${(err as Error).message}`.slice(0, 500),
        });
        tally.failed += 1;
        return 0;
      });

      budget -= spent;
    }

    if (budget <= 0) {
      notes.push(
        `The per-run send limit was reached. Anyone still waiting goes out on the next run, within fifteen minutes.`
      );
    }

    /*
     * The platform's own recap, after the customers'. Deliberately last: if
     * the budget runs out, the people running the platform are the ones who
     * can look at the page instead, and a customer's morning should not be
     * spent on ours.
     */
    if (budget > 0) {
      const spent = await sendPlatformRecap(now, budget, tally).catch(async (err) => {
        await logAgent({
          agent: "daily-recap",
          action: "recap-platform-failed",
          level: "error",
          status: "error",
          message: `The platform recap failed: ${(err as Error).message}`.slice(0, 500),
        });
        tally.failed += 1;
        return 0;
      });
      budget -= spent;
    }

    const parts = [
      `${tally.sent} sent`,
      tally.late > 0 ? `${tally.late} late` : null,
      tally.skipped > 0 ? `${tally.skipped} quiet day(s) skipped` : null,
      tally.failed > 0 ? `${tally.failed} failed` : null,
      tally.deferred > 0 ? `${tally.deferred} already handled` : null,
    ].filter(Boolean);

    return {
      ok: tally.failed === 0,
      summary: `Daily recap: ${parts.join(", ")}.`,
      ...(notes.length > 0 ? { reasoning: notes.join(" ") } : {}),
      data: { ...tally, bouncesMatched: bounces.matched },
    };
  },
};

/**
 * The cross-account recap for allowlisted platform administrators.
 *
 * Kept on the same settings as everything else it can honestly share: the send
 * time and late window come from the founding organization's settings, because
 * a platform admin is a person with one morning like anybody else. What it
 * does not share is the content or the delivery scope: `scope='platform'` and
 * a null org, so the once-a-day index treats it as its own thing and a
 * customer's recap can never collide with it.
 *
 * Returns how much of the send budget it used.
 */
async function sendPlatformRecap(now: Date, budget: number, tally: RunTally): Promise<number> {
  const admins = platformAdminEmails();
  if (admins.size === 0) return 0;

  const recipients = await platformRecapRecipients(admins);
  if (recipients.length === 0) return 0;

  // The platform's own account holds the operational settings; the recipient
  // list here is the allowlist, not that account's members.
  const settings = await getRecapSettings(LEGACY_ORG_ID);

  let spent = 0;
  const built = new Map<string, ReturnType<typeof buildPlatformRecap>>();

  for (const recipient of recipients) {
    if (spent >= budget) break;

    const timezone = safeTimeZone(recipient.timezone);
    const decision = recapDue({
      now,
      timezone,
      sendAt: settings.send_at,
      cutoffHours: settings.late_cutoff_hours,
    });
    if (!decision.due) continue;

    const summarised = addLocalDays(decision.localDate, -1);

    const claim = await claimDelivery({
      orgId: null,
      userId: null,
      recipientEmail: recipient.email,
      scope: "platform",
      localDate: summarised,
      timezone,
      dueAt: decision.dueAt,
      late: decision.late,
    });
    if (!claim.delivery) {
      tally.deferred += 1;
      continue;
    }

    const key = `${summarised}|${timezone}`;
    let recap = built.get(key);
    if (!recap) {
      const window = dayWindow(summarised, timezone);
      const facts = await gatherPlatformFacts(window.start, window.end);
      recap = buildPlatformRecap(facts, { localDate: summarised, timezone, now });
      built.set(key, recap);
    }

    // A quiet platform morning is worth saying out loud rather than skipping:
    // silence from the thing that reports failures is indistinguishable from
    // the thing being broken.
    const rendered = renderRecapEmail(recap, {
      appUrl: config.appUrl,
      recipientName: recipient.name,
      orgName: "the platform",
      late: decision.late,
    });

    // Stamped before the provider is called, so a crash in the next second
    // reads as "we do not know" rather than as "never sent". See markAttempting.
    await markAttempting(claim.delivery.id);

    const result = await systemMail.sendDigest({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    const failure = result.error ?? (result.disabled ? "Platform inbox is not connected." : null);

    if (failure) {
      await markFailed(claim.delivery.id, failure, {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        quiet: recap.quiet,
        urgentCount: recap.urgentCount,
      });
      tally.failed += 1;
      await logAgent({
        agent: "daily-recap",
        action: "recap-unsent",
        level: "error",
        status: "error",
        message: `Could not send the ${summarised} platform recap to ${recipient.email}: ${failure}`.slice(
          0,
          500
        ),
      });
    } else {
      await markSent(claim.delivery.id, {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        quiet: recap.quiet,
        urgentCount: recap.urgentCount,
        providerMessageId: result.messageId ?? null,
      });
      tally.sent += 1;
      if (decision.late) tally.late += 1;
    }

    spent += 1;
    if (spent < budget) await sleep(PAUSE_BETWEEN_SENDS_MS);
  }

  return spent;
}

/** Returns how much of the send budget this account used. */
async function sendForOrg(
  orgId: string,
  now: Date,
  budget: number,
  tally: RunTally
): Promise<number> {
  const settings = await getRecapSettings(orgId);
  if (!settings.enabled) return 0;

  const recipients = await recapRecipients(orgId, settings);
  if (recipients.length === 0) return 0;

  let spent = 0;

  /*
   * One build per (day, zone) rather than one per person. Colleagues in the
   * same zone share a day and therefore share a recap; the queries behind it
   * are the expensive part and running them twice for two people reading the
   * same account is waste. The aging write happens on the first build of the
   * morning and is idempotent for the rest.
   */
  const built = new Map<string, Awaited<ReturnType<typeof buildRecapFor>>>();

  for (const recipient of recipients) {
    if (spent >= budget) break;

    const timezone = safeTimeZone(recipient.timezone);
    const decision = recapDue({
      now,
      timezone,
      sendAt: settings.send_at,
      cutoffHours: settings.late_cutoff_hours,
    });
    if (!decision.due) continue;

    // The morning is `decision.localDate`; the day it reports on is the one
    // that just ended.
    const summarised = addLocalDays(decision.localDate, -1);

    const claim = await claimDelivery({
      orgId,
      userId: recipient.userId,
      recipientEmail: recipient.email,
      scope: "org",
      localDate: summarised,
      timezone,
      dueAt: decision.dueAt,
      late: decision.late,
    });
    if (!claim.delivery) {
      tally.deferred += 1;
      continue;
    }

    const key = `${summarised}|${timezone}`;
    let build = built.get(key);
    if (!build) {
      build = await buildRecapFor({
        orgId,
        localDate: summarised,
        timezone,
        settings,
        now,
        recordAges: true,
      });
      built.set(key, build);
    }
    const { recap } = build;

    if (recap.quiet && settings.skip_when_empty) {
      await markSkipped(claim.delivery.id, "Nothing happened, and this account skips quiet days.");
      tally.skipped += 1;
      spent += 1;
      continue;
    }

    const rendered = renderRecapEmail(recap, {
      appUrl: config.appUrl,
      recipientName: recipient.name,
      orgName: recap.orgName,
      late: decision.late,
    });

    // See the platform loop above: the stamp goes down before the send, not
    // after, because the case it exists for is the process dying between them.
    await markAttempting(claim.delivery.id);

    const result = await systemMail.sendDigest({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    const failure = result.error ?? (result.disabled ? "Platform inbox is not connected." : null);

    if (failure) {
      await markFailed(claim.delivery.id, failure, {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        quiet: recap.quiet,
        urgentCount: recap.urgentCount,
      });
      tally.failed += 1;
      /*
       * Logged under its own action, not the success one. The dedupe checks
       * elsewhere in this codebase look for a prior action in a window, and a
       * failure recorded under the success name would suppress the retry that
       * is the entire point of noticing.
       */
      await logAgent({
        agent: "daily-recap",
        action: "recap-unsent",
        level: "error",
        status: "error",
        message:
          `Could not send the ${summarised} recap to ${recipient.email}: ${failure}. It is kept in the delivery history and can be retried from the recap settings page.`.slice(
            0,
            500
          ),
      });
    } else {
      await markSent(claim.delivery.id, {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        quiet: recap.quiet,
        urgentCount: recap.urgentCount,
        providerMessageId: result.messageId ?? null,
      });
      tally.sent += 1;
      if (decision.late) tally.late += 1;
      await logAgent({
        agent: "daily-recap",
        action: "recap-sent",
        level: "info",
        message: `Recap for ${summarised} sent to ${recipient.email}${
          decision.late ? " (late)" : ""
        }, ${recap.urgentCount} urgent item(s).`,
      });
    }

    spent += 1;
    if (spent < budget) await sleep(PAUSE_BETWEEN_SENDS_MS);
  }

  return spent;
}
