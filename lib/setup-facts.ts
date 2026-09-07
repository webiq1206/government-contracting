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
import { resolveTenantOrgId } from "./tenant";

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

/**
 * The checklist plus the live facts that could not be verified while building
 * it. Callers keep rendering the conservative checklist, but must place these
 * warnings beside it so a failed read cannot masquerade as unfinished setup.
 */
export interface AccountSetupResult extends SetupChecklist {
  warnings: string[];
}

export async function accountSetup(
  profile: SetupInputs["profile"],
  user: SetupUser | null | undefined,
  /** The organization's name, for the step that is finished by definition. */
  orgName?: string | null
): Promise<AccountSetupResult> {
  const warnings: string[] = [];
  await hydrateIntegrationEnv().catch(() => {
    warnings.push(
      "Connected-service configuration could not be prepared, so setup integration status is not authoritative."
    );
  });
  // Credential readiness is strictly per organization. Deployment status is
  // used only to answer whether the Google OAuth connect button can exist.
  const platform = integrationStatus();
  const [orgKeys, inbox] = await Promise.all([
    orgIntegrationStatus().catch(() => {
      warnings.push(
        "SAM.gov, Anthropic, and Google Maps connection status could not be verified. Do not add or replace keys based only on this checklist."
      );
      return null;
    }),
    // integrationStatus().gmail is whether the PLATFORM holds Google OAuth
    // credentials, which is true for every customer on the deployment at once.
    // Read as "the inbox step is done" it marked a brand-new account complete
    // while no mailbox was connected and no outreach could send. The step is
    // about this organization's own grant, so ask for that.
    gmail.connection().catch(() => {
      warnings.push(
        "The connected inbox could not be verified. Reload or open Integrations before reconnecting it."
      );
      return null;
    }),
  ]);
  const integrations = {
    sam: orgKeys?.sam ?? false,
    claude: orgKeys?.claude ?? false,
    googleMaps: orgKeys?.googleMaps ?? false,
    gmail: inbox?.connected ?? false,
  };

  /*
   * What each credential has actually done.
   *
   * This is the whole difference between the old checklist and this one. A
   * key typed into a form proves that somebody typed a key. Whether it works
   * is a separate fact, and the integration record already holds it: the last
   * time it did real work, the last time somebody tested it, and the last
   * error. When that evidence cannot be read, the step stays unproven and the
   * page receives an explicit warning rather than a confident tick.
   */
  const stored = await listSettings().catch(() => {
    warnings.push(
      "Credential test history could not be loaded, so saved keys are not marked as proven on this checklist."
    );
    return null;
  });
  const byKey = new Map((stored ?? []).map((r) => [r.env_key, r]));
  const proof: SetupInputs["proof"] = {};
  for (const [step, envKey] of Object.entries(PROOF_KEYS)) {
    const row = byKey.get(envKey);
    const configured = integrations[step as keyof typeof PROOF_KEYS];
    if (!configured) continue;
    // A failed history read must not turn `configured` into proof that the
    // credential works. An empty proof object makes the pure checklist say it
    // is saved but untested, while the visible warning explains why no test
    // record could be read.
    if (stored == null) {
      proof[step as keyof typeof PROOF_KEYS] = { configured: true };
      continue;
    }
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
   * Each is loaded independently. A failed read produces a conservative value
   * plus a warning, so the rest of the checklist remains useful without
   * reporting an empty pipeline or reviewed rules that were never verified.
   */
  const [rulesRow, rules, counts] = await Promise.all([
    rulesReviewed().catch(() => {
      warnings.push(
        "Whether the automation rules were reviewed could not be checked. The checklist does not treat them as reviewed."
      );
      return false;
    }),
    getAutomationRules().catch(() => {
      warnings.push(
        "Automation contact limits could not be loaded, so the checklist cannot describe the limits currently in force."
      );
      return null;
    }),
    firstRunCounts().catch(() => {
      warnings.push(
        "First-run pipeline totals could not be counted, so setup progress does not claim that the pipeline is empty."
      );
      return undefined;
    }),
  ]);

  const level = user ? accessLevel(entitlementOf(user)) : null;
  // Trial organizations borrow the platform's Anthropic and Maps keys, so
  // those steps are due before the trial ends rather than immediately. Saying
  // "Required" on day one is false, and a checklist that overstates urgency
  // stops being read.
  const onTrial = user ? accessLevel(entitlementOf(user)) === "trial" : false;
  const checklist = computeSetupChecklist({
    orgName: orgName ?? null,
    profile: profile ?? null,
    integrations,
    proof,
    // Without OAuth credentials on the deployment there is no button to press,
    // so the step is impossible rather than outstanding and says so.
    gmailOffered: platform.gmail,
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
  return { ...checklist, warnings };
}

/**
 * What has been through the pipeline on this account.
 *
 * Scoped to the tenant. Resolution and query failures propagate to the caller,
 * which records an availability warning and passes undefined into the pure
 * checklist: "nobody counted" and "nothing happened" are different sentences.
 */
async function firstRunCounts(): Promise<
  { opportunities: number; scored: number; outreachSent: number } | undefined
> {
  const orgId = await resolveTenantOrgId();
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
