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

/** The entitlement fields the trial check needs, and nothing else. */
export interface SetupUser {
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
  billingExempt?: boolean | null;
  suspendedAt?: string | null;
}

export async function accountSetup(
  profile: SetupInputs["profile"],
  user: SetupUser | null | undefined
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
  // Trial organizations borrow the platform's Anthropic and Maps keys, so
  // those steps are due before the trial ends rather than immediately. Saying
  // "Required" on day one is false, and a checklist that overstates urgency
  // stops being read.
  const onTrial = user ? accessLevel(entitlementOf(user)) === "trial" : false;
  return computeSetupChecklist({
    profile: profile ?? null,
    integrations,
    // Without OAuth credentials on the deployment there is no button to press,
    // so the step is impossible rather than outstanding and says so.
    gmailOffered: env.gmail,
    onTrial,
  });
}
