/**
 * One answer to "how far is this account through setup".
 *
 * There were four callers computing it, and they did not agree. Today mixed
 * the deployment's environment keys with the customer's own and passed the
 * trial flag; both Guide Me routes read the environment alone and passed no
 * trial flag. On a trial account with its own SAM key, Today said the step was
 * done and the Guide Me panel, on the same screen, listed it as outstanding
 * and marked two borrowed credentials "Required".
 *
 * A checklist that disagrees with itself teaches the operator to ignore both
 * copies, which is worse than either being wrong on its own.
 *
 * Server-only: reads integration settings and the signed-in user's
 * entitlement.
 */
import { integrationStatus } from "./config";
import { orgIntegrationStatus } from "./integration-keys";
import { hydrateIntegrationEnv } from "./integration-settings";
import {
  computeSetupChecklist,
  type SetupChecklist,
  type SetupInputs,
} from "./domain/setup";
import { accessLevel, entitlementOf } from "./billing/entitlements";
import { gmail } from "./integrations/gmail";
import { listSettings } from "./integration-settings";
import { getAutomationRules, rulesReviewed } from "./app-settings";
import { daysLeft } from "./domain/account-status";
import { query } from "./db";
import { tryResolveTenantOrgId } from "./tenant";

/** The entitlement fields the trial check needs, and nothing else. */
export interface SetupUser {
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
  billingExempt?: boolean | null;
  suspendedAt?: string | null;
}

/** Which stored setting proves each step, and what its absence means. */
const PROOF_KEYS = {
  sam: "SAM_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  googleMaps: "GOOGLE_MAPS_API_KEY",
} as const;

export async function accountSetup(
  profile: SetupInputs["profile"],
  user: SetupUser | null | undefined,
  /** The organization's name, for the step that is finished by definition. */
  orgName?: string | null
): Promise<SetupChecklist> {
  await hydrateIntegrationEnv().catch(() => undefined);
  // Per-organization over per-deployment: the customer's own saved keys win
  // over whatever this deployment happens to have in its environment.
  const env = integrationStatus();
  const [orgKeys, inbox] = await Promise.all([
    orgIntegrationStatus().catch(() => ({})),
    // integrationStatus().gmail is whether the PLATFORM holds Google OAuth
    // credentials, which is true for every customer on the deployment at once.
    // Read as "the inbox step is done" it marked a brand-new account complete
    // while no mailbox was connected and no outreach could send. The step is
    // about this organization's own grant, so ask for that.
    gmail.connection().catch(() => ({ connected: false })),
  ]);
  const integrations = { ...env, ...orgKeys, gmail: inbox.connected };

  /*
   * What each credential has actually done.
   *
   * This is the whole difference between the old checklist and this one. A
   * key typed into a form proves that somebody typed a key. Whether it works
   * is a separate fact, and the integration record already holds it: the last
   * time it did real work, the last time somebody tested it, and the last
   * error. A step that cannot read its record falls back to the old meaning
   * rather than accusing a working account of being untested.
   */
  const stored = await listSettings().catch(() => []);
  const byKey = new Map(stored.map((r) => [r.env_key, r]));
  const proof: SetupInputs["proof"] = {};
  for (const [step, envKey] of Object.entries(PROOF_KEYS)) {
    const row = byKey.get(envKey);
    const configured = integrations[step as keyof typeof PROOF_KEYS];
    if (!configured) continue;
    // A key that lives in the deployment environment rather than in this
    // organization's settings has no record to read, so it keeps the old
    // meaning: present counts.
    if (!row) continue;
    proof[step as keyof typeof PROOF_KEYS] = {
      configured: true,
      lastSuccessAt: row.last_success_at,
      lastTestedAt: row.last_tested_at ?? row.last_validated_at,
      lastError: row.last_error,
    };
  }

  /*
   * The rest of the workflow, which the checklist used to stop short of.
   *
   * Each of these is loaded defensively and left undefined on failure, so a
   * database hiccup drops a step from the list rather than reporting an empty
   * pipeline or a locked account that is neither.
   */
  const [rulesRow, rules, counts] = await Promise.all([
    rulesReviewed().catch(() => false),
    getAutomationRules().catch(() => null),
    firstRunCounts().catch(() => undefined),
  ]);

  const level = user ? accessLevel(entitlementOf(user)) : null;
  // Trial organizations borrow the platform's Anthropic and Maps keys, so
  // those steps are due before the trial ends rather than immediately. Saying
  // "Required" on day one is false, and a checklist that overstates urgency
  // stops being read.
  const onTrial = user ? accessLevel(entitlementOf(user)) === "trial" : false;
  return computeSetupChecklist({
    orgName: orgName ?? null,
    profile: profile ?? null,
    integrations,
    proof,
    // Without OAuth credentials on the deployment there is no button to press,
    // so the step is impossible rather than outstanding and says so.
    gmailOffered: env.gmail,
    onTrial,
    rules: {
      reviewed: rulesRow,
      outreachBatchLimit: rules?.outreach_batch_limit ?? null,
      followupHours: rules?.followup_hours ?? null,
    },
    access: level
      ? {
          level,
          comped: Boolean(user?.billingExempt),
          trialDaysLeft:
            level === "trial" && user?.trialEndsAt ? daysLeft(user.trialEndsAt, new Date()) : null,
        }
      : undefined,
    firstRun: counts,
  });
}

/**
 * What has been through the pipeline on this account.
 *
 * Scoped to the tenant, and returns undefined rather than zeros when it
 * cannot resolve one: "nobody counted" and "nothing happened" are different
 * sentences, and the checklist prints them differently.
 */
async function firstRunCounts(): Promise<
  { opportunities: number; scored: number; outreachSent: number } | undefined
> {
  const orgId = await tryResolveTenantOrgId().catch(() => null);
  if (!orgId) return undefined;
  const rows = await query<{ opportunities: string; scored: string; outreach: string }>(
    `select
       (select count(*) from opportunities o where o.org_id = $1) as opportunities,
       (select count(*) from opportunities o where o.org_id = $1 and o.score is not null) as scored,
       (select count(*) from communications c
         where c.org_id = $1 and c.direction = 'outbound') as outreach`,
    [orgId]
  );
  const r = rows[0];
  if (!r) return undefined;
  return {
    opportunities: Number(r.opportunities),
    scored: Number(r.scored),
    outreachSent: Number(r.outreach),
  };
}
