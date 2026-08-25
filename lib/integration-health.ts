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
}

/**
 * Six hours, matching the SAM.gov error window elsewhere: long enough to catch
 * an overnight failure, short enough that a topped-up account clears the alarm
 * on its own without anyone dismissing anything.
 */
const WINDOW = "6 hours";

export async function recentAiTrouble(orgId?: string): Promise<ServiceTrouble> {
  const org = orgId ?? (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  const row = await queryOne<{ n: number; message: string | null }>(
    `select count(*)::int as n,
            (array_agg(message order by created_at desc))[1] as message
       from agent_logs
      where level = 'error' and org_id = $1
        and message like $2
        and created_at > now() - interval '${WINDOW}'`,
    [org, `%${AI_UNAVAILABLE_PREFIX}%`]
  ).catch(() => null);
  const count = row?.n ?? 0;
  return { count, reason: count > 0 ? stripMarker(row?.message ?? null) : null };
}

/** One sentence for a status line, or null when there is nothing wrong. */
export function troubleSummary(t: ServiceTrouble): string | null {
  if (t.count === 0) return null;
  return `${t.count} job${t.count === 1 ? "" : "s"} failed in the last ${WINDOW}. ${
    t.reason ?? "The service refused the request."
  }`;
}

/** The marker is for matching, not for reading; the reason is the readable part. */
function stripMarker(message: string | null): string | null {
  if (!message) return null;
  const at = message.indexOf(AI_UNAVAILABLE_PREFIX);
  const text = at === -1 ? message : message.slice(at + AI_UNAVAILABLE_PREFIX.length);
  return text.trim().slice(0, 240);
}
