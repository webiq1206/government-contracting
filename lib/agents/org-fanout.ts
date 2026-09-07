/**
 * Which accounts a platform-wide agent should work on, and what to do when
 * that question cannot be answered.
 *
 * Six agents opened with the same two lines:
 *
 *   let orgs = await listActiveOrganizations().catch(() => []);
 *   if (orgs.length === 0) orgs = [{ id: LEGACY_ORG_ID }];
 *
 * The fallback is right for a genuinely empty list: a fresh deployment before
 * anybody has signed up still has the founding organization's own work to do.
 * It is wrong for a query that threw, and the two were indistinguishable. A
 * database hiccup on that one statement meant every customer was skipped, the
 * agent ran against the founding org alone, and the run reported success:
 * "Compliance monitor: 1 org checked" on a platform with forty.
 *
 * That is the shape this whole audit is about. An automation that quietly does
 * less work is worse than one that stops, because the summary reads the same
 * either way and nothing on the health page moves.
 *
 * So the two cases are separated here, once, rather than in six places that
 * each have to remember.
 */
import { listActiveOrganizations, type Organization } from "../organizations";
import { currentOrgId, LEGACY_ORG_ID, runWithOrg } from "../tenant-context";
import { isAutomationPaused } from "../app-settings";
import { logAgent } from "../logger";

export interface OrgFanout {
  /** The accounts to iterate. Empty only when the lookup failed. */
  orgs: Organization[];
  /** The lookup's error, if it threw. Null on success, empty list included. */
  error: string | null;
  /**
   * True when the list came back genuinely empty and the founding
   * organization was substituted. Not an error: it is what a deployment looks
   * like before its first customer.
   */
  soloFallback: boolean;
  /** Accounts deliberately excluded because their own master switch is paused. */
  pausedCount: number;
}

/**
 * The accounts to sweep, with the failure kept distinct from the empty case.
 *
 * On failure this logs once, at error status so `automation-status` counts it,
 * and returns no organizations. A caller that iterates the empty list does
 * nothing, which is correct: the alternative is guessing at a customer list
 * and running somebody's automation against the wrong tenant.
 */
export async function orgsToSweep(agent: string): Promise<OrgFanout> {
  // A manual or record-triggered run already has an owning organization from
  // the runner. In that case this is not a platform sweep: pressing Run now
  // in one account must never trigger work for every other customer.
  const scopedOrg = currentOrgId();
  if (scopedOrg) {
    const paused = await isAutomationPaused();
    return {
      orgs: paused ? [] : ([{ id: scopedOrg }] as Organization[]),
      error: null,
      soloFallback: false,
      pausedCount: paused ? 1 : 0,
    };
  }

  let orgs: Organization[];
  try {
    orgs = await listActiveOrganizations();
  } catch (err) {
    const error = (err as Error).message;
    await logAgent({
      agent,
      action: "org-list-failed",
      level: "error",
      status: "error",
      message:
        `Could not read the list of accounts to work on: ${error}. This run did nothing for anybody. ` +
        `It is not the same as having no accounts, and the next scheduled run will try again.`.slice(
          0,
          500
        ),
    });
    return { orgs: [], error, soloFallback: false, pausedCount: 0 };
  }

  let soloFallback = false;
  if (orgs.length === 0) {
    orgs = [{ id: LEGACY_ORG_ID } as Organization];
    soloFallback = true;
  }

  // A cron sweep has no payload, so the runner cannot resolve one account and
  // enforce its pause switch before the handler starts. Enforce it while the
  // fanout still knows exactly which account each iteration belongs to.
  const runnable: Organization[] = [];
  let pausedCount = 0;
  for (const org of orgs) {
    const paused = await runWithOrg(org.id, () => isAutomationPaused());
    if (paused) pausedCount++;
    else runnable.push(org);
  }

  return { orgs: runnable, error: null, soloFallback, pausedCount };
}

/**
 * The sentence an agent adds when it could not find out whom to work for.
 *
 * Kept beside the lookup so every agent says the same thing about the same
 * condition, and so the wording is one edit rather than six.
 */
export function fanoutNote(fanout: OrgFanout): string | null {
  if (fanout.error) {
    return `No accounts were processed: the list of accounts could not be read (${fanout.error}).`;
  }
  if (fanout.orgs.length === 0 && fanout.pausedCount > 0) {
    return `No accounts were processed because automation is paused for ${fanout.pausedCount} account${fanout.pausedCount === 1 ? "" : "s"}.`;
  }
  return null;
}
