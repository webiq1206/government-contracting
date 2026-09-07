/**
 * Pipeline pulse: is the machine that finds deals and emails subs actually
 * running, and if not, which leg is broken?
 *
 * The pipeline has exactly three legs a customer can see fail:
 *
 *   1. discovery, SAM.gov polls that produce new opportunities
 *   2. movement, the worker + scheduler that advance every record
 *   3. outreach, the connected inbox the emails leave through
 *
 * Each can die silently: the worker stops on a web-only deployment, a SAM key
 * expires and every poll comes back "empty", a Google grant is revoked and
 * sends fail one by one. In every case the dashboard used to look merely
 * quiet. This module turns each of those silences into a named finding with
 * the fix spelled out, and the Today page shows them where they cannot be
 * missed.
 *
 * Pure: the caller gathers the facts, this decides what they mean.
 */

export type PulseSeverity = "down" | "warn";

export interface PulseFinding {
  key:
    | "worker_down"
    | "worker_starting"
    | "worker_idle"
    | "monitor_stalled"
    | "sam_failing"
    | "sam_quota"
    | "gmail_broken"
    | "outreach_failing"
    | "outreach_drafts"
    | "automation_paused"
    | "claude_off"
    | "claude_failing"
    | "no_active_orgs";
  severity: PulseSeverity;
  title: string;
  detail: string;
  /** Where the fix lives. */
  href: string;
  cta: string;
}

export interface PulseInput {
  now: Date;
  /** Most recent job_runs.started_at across every agent (platform-wide). */
  workerLastRunAt: string | null;
  /**
   * Last time the worker process checked in, and what it was doing.
   *
   * A job log alone cannot tell a dead worker from a busy-doing-nothing one,
   * and it told the owner "not running" for a night when the truth was "stuck
   * half-way through starting". Undefined means the caller has no heartbeat to
   * offer (an older deployment), and the reading falls back to job history.
   */
  workerHeartbeatAt?: string | null;
  workerPhase?: string | null;
  workerBootedAt?: string | null;
  /** Open opportunities for this organization. */
  openCount: number;
  /** True when this org has a SAM key connected. */
  samKeyPresent: boolean;
  /** Last successful opportunity-monitor run (platform-wide cron). */
  monitorLastOkAt: string | null;
  /** Latest poll-sam ERROR logged for this org, if newer than the last OK run. */
  samErrorMessage: string | null;
  samQuota: { used: number; cap: number };
  gmail: { connected: boolean; status: string; lastError: string | null };
  outreach: { sendFailed: number; drafts: number };
  /**
   * The master pause switch. When it is on, the scheduler stops enqueuing and
   * every send is refused, so the whole engine goes quiet with no error to
   * find. It is the most common reason for "nothing is happening", and the
   * pulse never mentioned it.
   */
  automationPaused?: boolean;
  /** Whether an Anthropic key is configured. Without it nothing gets scored,
   *  analysed, or drafted, so discovery piles up and never advances. */
  claudeConfigured?: boolean;
  /**
   * Recent agent failures whose cause was Anthropic refusing the request:
   * how many, and the plain-English reason from the newest one.
   *
   * A configured key told us nothing about whether the account behind it can
   * still serve a request. It cannot tell the difference between a working
   * integration and an account out of credits, and the second looked exactly
   * like the first on every screen while every scoring, analysis and drafting
   * job failed. This is the difference, and it comes from what actually
   * happened rather than from what is configured.
   */
  /**
   * Failures against the AI inside a rolling window, with WHEN the most recent
   * one was. The timestamp is not decoration: a count on its own cannot tell
   * an ongoing outage from one that ended an hour ago, and this banner used to
   * say "is refusing every request" in the present tense on the strength of
   * rows written before the cause was fixed.
   */
  claudeFailures?: { count: number; reason: string | null; lastAt?: Date | null };
  /** Active organizations the engine has to work for; zero means idle by
   *  definition, not broken. */
  activeOrgCount?: number;
  /**
   * How often the monitor is scheduled, in English, from the registry.
   *
   * Absent rather than assumed: a caller that cannot reach the registry gets a
   * sentence with no cadence in it, which is better than a sentence with the
   * wrong one. That is the exact failure this field exists to end.
   */
  monitorCadence?: string | null;
}

const H = 3_600_000;

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / H;
}

/**
 * Two missed slots plus slack means the monitor is not "between runs", it is
 * not running.
 *
 * Derived from a three-hourly schedule. tests/agent-cadence.test.ts asserts
 * the registry still schedules the monitor at least that often, so making the
 * schedule sparser fails there rather than quietly turning this into a
 * threshold that never fires.
 */
const MONITOR_STALL_HOURS = 7;
/** Sweeps run every 10-20 min; hours of silence means the worker is down. */
const WORKER_STALL_HOURS = 2;
/**
 * The worker beats every 30 seconds. Ten missed beats rides out a slow query
 * or a restart without calling a healthy engine dead.
 */
const HEARTBEAT_STALE_MINUTES = 5;
/** The phase name the worker reports once handlers are registered. */
const READY_PHASE = "ready";
/** Booted, but the queue backend stopped answering. */
const DEGRADED_PHASE = "queue-unreachable";

function minutesSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 60_000;
}

function ago(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.floor(minutes))} minute(s)`;
  return `${Math.floor(minutes / 60)} hour(s)`;
}

export function evaluatePulse(input: PulseInput): PulseFinding[] {
  const findings: PulseFinding[] = [];

  // The master switch first: if automation is paused, every other quiet
  // symptom below has the same one cause, and the fix is a single toggle.
  if (input.automationPaused) {
    findings.push({
      key: "automation_paused",
      severity: "down",
      title: "Automation is paused, so nothing is running.",
      detail:
        "The master automation switch is off. No deals are being found, no emails are being sent, and no follow-ups are going out until it is turned back on. Nothing is broken, and turning it on resumes everything from where it left off.",
      href: "/settings",
      cta: "Resume automation",
    });
    return findings;
  }

  if (input.claudeConfigured === false) {
    findings.push({
      key: "claude_off",
      severity: "down",
      title: "Scoring and drafting need an AI connection.",
      detail:
        "Your account has no AI connection for scoring opportunities, preparing briefs, or drafting outreach. Open Integrations to connect it or see who can complete setup.",
      href: "/settings/integrations",
      cta: "Review AI connection",
    });
    // Not a hard return: the worker/SAM legs below still report, because they
    // are independent failures worth seeing at the same time.
  } else if (input.claudeFailures && input.claudeFailures.count > 0) {
    // Only when a key IS configured. Without one there is nothing to refuse
    // us, and "claude_off" above already owns that message.
    const n = input.claudeFailures.count;
    const lastAt = input.claudeFailures.lastAt ?? null;
    /*
     * Thirty minutes, matching lib/integration-health: two cycles of the
     * fastest AI-using agents. Past that, failures have stopped, and saying
     * otherwise sends somebody to fix an account that is already fixed.
     */
    const stopped = lastAt !== null && input.now.getTime() - lastAt.getTime() > 30 * 60_000;
    findings.push(
      stopped
        ? {
            key: "claude_failing",
            severity: "warn",
            title: `${n} AI job${n === 1 ? " failed" : "s failed"} in the last six hours.`,
            detail:
              "No new failures were recorded in the last half hour. A quiet period alone does not confirm recovery. " +
              "Open Integrations to check the connection. Once it is working and automation is running, eligible unfinished work is picked back up automatically, according to its retry schedule. " +
              `Last failure said: ${input.claudeFailures.reason ?? "the service refused the request."}`,
            href: "/settings/integrations",
            cta: "Open Integrations",
          }
        : {
            key: "claude_failing",
            severity: "down",
            title: `${n} AI job${n === 1 ? " has" : "s have"} failed recently.`,
            detail:
              `${input.claudeFailures.reason ?? "Anthropic refused the request."} ` +
              "Scoring, analysis, or drafting may be delayed. Open Integrations to check the connection and recovery steps.",
            href: "/settings/integrations",
            cta: "Open Integrations",
          }
    );
  }

  if (input.activeOrgCount === 0) {
    findings.push({
      key: "no_active_orgs",
      severity: "warn",
      title: "There are no active organizations for the engine to work for.",
      detail:
        "Automation runs per organization, and none is active (a lapsed trial or subscription pauses its work). Nothing will run until at least one is active.",
      href: "/settings/billing",
      cta: "Check the subscription",
    });
  }

  const workerAge = hoursSince(input.workerLastRunAt, input.now);
  const beatAge = minutesSince(input.workerHeartbeatAt, input.now);
  const beating = beatAge != null && beatAge <= HEARTBEAT_STALE_MINUTES;
  const ready = (input.workerPhase ?? null) === READY_PHASE;

  // Alive but never finished starting. This is its own fault with its own fix,
  // and calling it "not running" sent the owner to the deployment settings for
  // a problem that was not there.
  if (beating && !ready) {
    const bootAge = minutesSince(input.workerBootedAt, input.now);
    const degraded = input.workerPhase === DEGRADED_PHASE;
    findings.push({
      key: "worker_starting",
      severity: "down",
      title: degraded
        ? "The automation engine has lost its connection to the job queue."
        : "The automation engine is stuck starting up.",
      detail: degraded
        ? "Scheduled work cannot start because its queue is unavailable. Reconnection is automatic. Open Automation Health to check progress and recovery steps."
        : `The engine is alive and checking in, but it has not finished starting${
            bootAge != null ? ` after ${ago(bootAge)}` : ""
          }. Scheduled discovery, email, and follow-ups cannot start yet. ` +
          "Startup retries automatically. Open Automation Health to see the blocked step and recovery options.",
      href: "/agents",
      cta: "Open Automation Health",
    });
    return findings;
  }

  const workerDown =
    !beating &&
    ((workerAge != null && workerAge > WORKER_STALL_HOURS) ||
      (input.workerLastRunAt == null && input.openCount > 0));

  if (workerDown) {
    const lastSeen = beatAge != null ? ` The engine last checked in ${ago(beatAge)} ago.` : "";
    findings.push({
      key: "worker_down",
      severity: "down",
      title: "Automated work has stopped checking in.",
      detail:
        input.workerLastRunAt == null
          ? "No completed work or recent check-in is recorded while opportunities are waiting. Discovery, scoring, and follow-ups may be blocked. Open Automation Health to check and restore the service." +
            lastSeen
          : `No automated work has started for ${Math.floor(workerAge!)} hour(s), and no recent check-in is available. Discovery and follow-ups may be delayed. Open Automation Health to check and restore the service.` +
            lastSeen,
      href: "/agents",
      cta: "Open Automation Health",
    });
    // Everything below depends on the worker; one alarm is a diagnosis,
    // four alarms with one cause is noise.
    return findings;
  }

  // Proven alive, but the job log is old. Not the same emergency: the engine
  // is there to be asked, so this is "check what it is doing", not "it is
  // gone". Other legs still get to report, because the worker is up to run
  // them.
  if (beating && ready && workerAge != null && workerAge > WORKER_STALL_HOURS) {
    findings.push({
      key: "worker_idle",
      severity: "warn",
      title: "The automation engine is running, but nothing has run recently.",
      detail: `The engine checked in ${ago(beatAge!)} ago, so it is up. It has not run any work for ${Math.floor(
        workerAge
      )} hour(s), which usually means automation is paused or nothing was due.`,
      href: "/agents",
      cta: "Open Automation Health",
    });
  }

  // Discovery leg. Only meaningful once a key is connected; before that the
  // setup checklist owns the message.
  if (input.samKeyPresent) {
    if (input.samErrorMessage) {
      findings.push({
        key: "sam_failing",
        severity: "down",
        title: "SAM.gov requests are failing, so new deals are NOT coming in.",
        detail: input.samErrorMessage,
        href: "/settings/integrations",
        cta: "Test the SAM key",
      });
    } else {
      const monitorAge = hoursSince(input.monitorLastOkAt, input.now);
      if (monitorAge == null || monitorAge > MONITOR_STALL_HOURS) {
        findings.push({
          key: "monitor_stalled",
          severity: "warn",
          title: "Deal discovery has not run recently.",
          detail:
            input.monitorLastOkAt == null
              ? `The Opportunity Monitor has never completed a run, so nothing has been pulled from SAM.gov yet. It runs ${
                  input.monitorCadence ? input.monitorCadence.toLowerCase() : "on a schedule"
                } once the worker is up; you can also run it now from the Agents page.`
              : `The Opportunity Monitor last completed ${Math.floor(monitorAge ?? 0)} hour(s) ago; it should run ${
                  input.monitorCadence ? input.monitorCadence.toLowerCase() : "on a schedule"
                }. Check Automation Health for what stopped it, or run it now from that page.`,
          href: "/agents",
          cta: "Run it now",
        });
      }
      if (input.samQuota.cap > 0 && input.samQuota.used >= input.samQuota.cap) {
        findings.push({
          key: "sam_quota",
          severity: "warn",
          title: "Today's SAM.gov call budget is used up.",
          detail: `All ${input.samQuota.cap} calls for today have been spent, so discovery is paused until the budget resets at midnight UTC. Nothing is lost; the next runs pick up anything posted meanwhile.`,
          href: "/settings/integrations",
          cta: "See usage",
        });
      }
    }
  }

  // Outreach leg. A revoked grant is a dead inbox even though a token row
  // still exists, and it stays dead until a human reconnects.
  const g = input.gmail;
  if (g.status === "revoked" || (g.connected && g.status === "error")) {
    findings.push({
      key: "gmail_broken",
      severity: "down",
      title:
        g.status === "revoked"
          ? "Google has disconnected the outreach inbox, so emails cannot send."
          : "The outreach inbox is failing, emails may not be sending.",
      detail: `${
        g.status === "revoked"
          ? "The Google sign-in for the connected inbox was revoked or expired. Every outreach and follow-up email is being held as a draft until it is reconnected."
          : "Recent sends through the connected inbox failed."
      }${g.lastError ? ` Last error: ${g.lastError.slice(0, 160)}` : ""}`,
      href: "/settings/integrations",
      cta: "Reconnect Google Inbox",
    });
  }

  if (input.outreach.sendFailed > 0) {
    findings.push({
      key: "outreach_failing",
      severity: "down",
      title: `${input.outreach.sendFailed} outreach email${
        input.outreach.sendFailed === 1 ? "" : "s"
      } failed to send.`,
      detail:
        "These subcontractors have not been contacted even though their opportunity moved forward. Each affected opportunity is flagged; fix the inbox connection and re-run outreach from the opportunity page.",
      href: "/pipeline?focus=in_pursuit",
      cta: "See affected opportunities",
    });
  } else if (input.outreach.drafts > 0 && !g.connected) {
    findings.push({
      key: "outreach_drafts",
      severity: "warn",
      title: `${input.outreach.drafts} outreach email${
        input.outreach.drafts === 1 ? "" : "s"
      } waiting as drafts.`,
      detail:
        "They were written but there is no connected inbox to send them from. Connect the Google inbox and they can go out.",
      href: "/settings/integrations",
      cta: "Connect Google Inbox",
    });
  }

  return findings;
}
