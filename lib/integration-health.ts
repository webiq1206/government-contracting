/**
 * What happened when we last USED a credential, as opposed to whether one is
 * stored.
 *
 * Every status on the Integrations page answered the second question and was
 * presented as an answer to the first: "Connected" meant a value existed in a
 * field, nothing more. An Anthropic account whose credit balance had run out
 * therefore read as connected while every scoring, analysis and drafting job
 * in the system failed against it, for a day, with the badge green. The
 * credential was fine. The service behind it was not, and nothing anywhere
 * knew the difference.
 *
 * The agent runner already writes each failure to `agent_logs`, and the AI
 * choke point tags the ones that mean "the service refused us" (see
 * AI_UNAVAILABLE_PREFIX). This module reads those back, so the page can report
 * what actually happened rather than what is configured.
 */
import { queryOne } from "./db";
import { tryResolveTenantOrgId } from "./tenant";
import { LEGACY_ORG_ID } from "./tenant-context";
import { AI_UNAVAILABLE_PREFIX } from "./ai/claude";

export interface ServiceTrouble {
  /** How many jobs failed on it inside the window. */
  count: number;
  /** Plain English, from the most recent failure. Null when count is 0. */
  reason: string | null;
  /**
   * When the most recent of those failures happened. Null when count is 0.
   *
   * The count alone cannot answer the only question an operator actually has,
   * which is whether the thing is broken NOW. A six-hour count is history: it
   * stays high for hours after the cause is fixed, because fixing an Anthropic
   * balance does not delete the rows written while it was empty. Somebody who
   * has just topped up their credits and still sees "490 failed jobs" has no
   * way to tell recovery from an ongoing outage, and the honest reading of
   * that screen is the wrong one.
   *
   * node-postgres hands back a Date for timestamptz, and it is kept as one:
   * the caller needs to do arithmetic on it, not print it.
   */
  lastAt: Date | null;
}

/**
 * How long the most recent failure must be in the past before the trouble is
 * reported as over rather than ongoing.
 *
 * Thirty minutes, because the fastest AI-using agents run every fifteen. Two
 * of those cycles have to come and go without a new failure before this stops
 * calling the service broken, which is the weakest claim the evidence
 * supports: it is not proof the AI works, only that nothing has failed since.
 * Anything shorter would clear the alarm on a gap between runs.
 */
const RECOVERED_AFTER_MS = 30 * 60_000;

/**
 * True when failures have stopped: there were some in the window, and the most
 * recent is old enough that agents have had two chances to fail again.
 *
 * Deliberately not called "healthy". Silence is not health, and this reports
 * only that the bleeding stopped.
 */
export function troubleHasStopped(t: ServiceTrouble, now = new Date()): boolean {
  if (t.count === 0 || !t.lastAt) return false;
  return now.getTime() - t.lastAt.getTime() > RECOVERED_AFTER_MS;
}

/** "4 minutes", "3 hours". For a sentence, so it reads rather than sorts. */
export function agoInWords(at: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Six hours, matching the SAM.gov error window elsewhere: long enough to catch
 * an overnight failure, short enough that a topped-up account clears the alarm
 * on its own without anyone dismissing anything.
 */
const WINDOW = "6 hours";

/**
 * When scoring or analysis last succeeded for this account.
 *
 * The Integrations card used to say "Saved, and never used" for Claude while
 * scoring ran all day: usage is written onto a saved-key row, and an env or
 * platform key never created one. Agent logs are the proof that the model
 * actually answered.
 */
async function lastAgentSuccess(
  agents: string[],
  orgId?: string
): Promise<Date | null> {
  if (agents.length === 0) return null;
  const org = orgId ?? (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  const row = await queryOne<{ at: Date | null }>(
    `select max(created_at) as at
       from agent_logs
      where org_id = $1
        and level in ('success', 'info')
        and agent = any($2::text[])`,
    [org, agents]
  ).catch(() => null);
  return row?.at ?? null;
}

export async function lastAiSuccess(orgId?: string): Promise<Date | null> {
  return lastAgentSuccess(
    ["scoring-engine", "solicitation-analyst", "pricing-research"],
    orgId
  );
}

/** When pricing comps last came back from USASpending for this account. */
export async function lastPricingSuccess(orgId?: string): Promise<Date | null> {
  return lastAgentSuccess(["pricing-research"], orgId);
}

export async function recentAiTrouble(orgId?: string): Promise<ServiceTrouble> {
  const org = orgId ?? (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  const row = await queryOne<{ n: number; message: string | null; last_at: Date | null }>(
    `select count(*)::int as n,
            (array_agg(message order by created_at desc))[1] as message,
            max(created_at) as last_at
       from agent_logs
      where level = 'error' and org_id = $1
        and message like $2
        and created_at > now() - interval '${WINDOW}'`,
    [org, `%${AI_UNAVAILABLE_PREFIX}%`]
  ).catch(() => null);
  const count = row?.n ?? 0;
  return {
    count,
    reason: count > 0 ? stripMarker(row?.message ?? null) : null,
    lastAt: count > 0 ? row?.last_at ?? null : null,
  };
}

/**
 * One sentence for a status line, or null when there is nothing wrong.
 *
 * Two sentences that read differently, because they mean different things. An
 * operator who has just fixed the cause needs the second one, and used to get
 * the first.
 */
export function troubleSummary(t: ServiceTrouble, now = new Date()): string | null {
  if (t.count === 0) return null;
  const jobs = `${t.count} job${t.count === 1 ? "" : "s"}`;
  if (troubleHasStopped(t, now) && t.lastAt) {
    return `${jobs} failed in the last ${WINDOW}, but the most recent was ${agoInWords(
      t.lastAt,
      now
    )} ago and nothing has failed since. That count is history inside a rolling ${WINDOW} window and clears on its own. Last failure: ${
      t.reason ?? "the service refused the request."
    }`;
  }
  return `${jobs} failed in the last ${WINDOW}, most recently ${
    t.lastAt ? `${agoInWords(t.lastAt, now)} ago` : "at an unknown time"
  }. ${t.reason ?? "The service refused the request."}`;
}

/** The marker is for matching, not for reading; the reason is the readable part. */
function stripMarker(message: string | null): string | null {
  if (!message) return null;
  const at = message.indexOf(AI_UNAVAILABLE_PREFIX);
  const text = at === -1 ? message : message.slice(at + AI_UNAVAILABLE_PREFIX.length);
  return text.trim().slice(0, 240);
}
