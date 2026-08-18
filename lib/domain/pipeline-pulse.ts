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
    | "monitor_stalled"
    | "sam_failing"
    | "sam_quota"
    | "gmail_broken"
    | "outreach_failing"
    | "outreach_drafts";
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
}

const H = 3_600_000;

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / H;
}

/**
 * The monitor runs every 3 hours; two missed slots plus slack means it is not
 * "between runs", it is not running.
 */
const MONITOR_STALL_HOURS = 7;
/** Sweeps run every 10-20 min; hours of silence means the worker is down. */
const WORKER_STALL_HOURS = 2;

export function evaluatePulse(input: PulseInput): PulseFinding[] {
  const findings: PulseFinding[] = [];
  const workerAge = hoursSince(input.workerLastRunAt, input.now);
  const workerDown =
    (workerAge != null && workerAge > WORKER_STALL_HOURS) ||
    (input.workerLastRunAt == null && input.openCount > 0);

  if (workerDown) {
    findings.push({
      key: "worker_down",
      severity: "down",
      title: "The automation engine is not running.",
      detail:
        input.workerLastRunAt == null
          ? "No automated work has ever run, though opportunities are waiting. Nothing will be found, scored, emailed, or followed up until the background worker is running."
          : `Nothing has run for ${Math.floor(workerAge!)} hour(s). New deals are not being found and no emails are going out. On Replit this means the app is not deployed as an always-on process: use a Reserved VM deployment (an Autoscale deployment sleeps between visits, which stops all background work).`,
      href: "/agents",
      cta: "Open the Automation Log",
    });
    // Everything below depends on the worker; one alarm is a diagnosis,
    // four alarms with one cause is noise.
    return findings;
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
              ? "The Opportunity Monitor has never completed a run, so nothing has been pulled from SAM.gov yet. It runs every 3 hours once the worker is up; you can also run it now from the Agents page."
              : `The Opportunity Monitor last completed ${Math.floor(monitorAge ?? 0)} hour(s) ago; it should run every 3 hours. Check the Automation Log for what stopped it, or run it now from the Agents page.`,
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
