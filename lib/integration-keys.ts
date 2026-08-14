/**
 * Per-organization API credentials.
 *
 * Every customer brings their own keys. That is not friction we invented: a
 * contractor without an approved SAM.gov account cannot bid on federal work
 * anyway, so they already have the thing we are asking for. The platform's own
 * keys must never run a customer's searches, be billed for their usage, or be
 * throttled by them.
 *
 * This replaces `hydrateIntegrationEnv()`, which loaded whichever tenant was
 * read most recently into `process.env` and refreshed it on a timer. Because
 * process.env is process-global and one worker serves every tenant's jobs, the
 * effective credential for all of them was whoever happened to be hydrated
 * last. Keys are now looked up per call against the organization that owns the
 * work, and never written anywhere shared.
 *
 * The founding organization keeps its environment variables, so the original
 * install and every script, health check, and migration keeps working. No
 * other organization can reach them.
 */
import { queryOne } from "./db";
import { decryptSecret, type AllowedEnvKey } from "./integration-settings";
import { LEGACY_ORG_ID } from "./tenant-context";

/**
 * Short per-process cache. A single page render asks for the same key several
 * times across different integrations, and a decrypt plus a round trip on each
 * would be wasteful. Keyed by organization so it can never serve one tenant's
 * credential to another, and short enough that a key saved in Settings takes
 * effect on the next page load rather than after a restart.
 */
const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { value: string; at: number }>();

/** Test helper: drop cached credentials between cases. */
export function clearIntegrationKeyCache(): void {
  cache.clear();
}

/**
 * The organization whose credentials apply to the current work.
 *
 * Resolves from the agent's async-local context first (background jobs run
 * inside runWithOrg) and then the signed-in user's membership.
 */
async function owningOrg(): Promise<string> {
  try {
    const { tryResolveTenantOrgId } = await import("./tenant");
    return (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  } catch {
    return LEGACY_ORG_ID;
  }
}

/**
 * One credential for one organization, or "" when they have not set it.
 *
 * An empty string is the honest answer for a tenant that has not entered a
 * key: the integration reports itself disabled and the UI names what is
 * missing. Falling back to the platform's environment here is precisely the
 * bug this module exists to remove.
 */
export async function orgApiKey(key: AllowedEnvKey, orgId?: string): Promise<string> {
  const org = orgId ?? (await owningOrg());
  const cacheKey = `${org}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const row = await queryOne<{ value_enc: string }>(
    `select value_enc from integration_settings where env_key = $1 and org_id = $2`,
    [key, org]
  ).catch(() => null);

  let value = row ? (decryptSecret(row.value_enc) ?? "") : "";

  // The founding organization predates the settings UI and configures itself
  // through the environment. This fallback is scoped to that one org on
  // purpose: it is the deployment's own account, not a customer's.
  if (!value && org === LEGACY_ORG_ID) {
    value = process.env[key]?.trim() ?? "";
  }

  cache.set(cacheKey, { value, at: Date.now() });
  return value;
}

/** True when this organization has the credential needed for a feature. */
export async function orgHasKey(key: AllowedEnvKey, orgId?: string): Promise<boolean> {
  return (await orgApiKey(key, orgId)).length > 0;
}

/**
 * Readiness for the CURRENT organization.
 *
 * The synchronous `integrationStatus()` in lib/config.ts reports on the
 * deployment's environment, which is the right answer for boot logs and the
 * health check and the wrong one for a customer: it would show the platform's
 * SAM key as "connected" on an account that has never entered one, and the
 * setup checklist would tick a step the customer has not done.
 *
 * Values that genuinely are platform-level (the database, public APIs) are
 * still reported from config.
 */
export async function orgIntegrationStatus(orgId?: string): Promise<{
  claude: boolean;
  sam: boolean;
  googleMaps: boolean;
  hunter: boolean;
  ahrefs: boolean;
  twilio: boolean;
}> {
  const org = orgId ?? (await owningOrg());
  const [claude, sam, googleMaps, hunter, ahrefs, twilioSid, twilioToken, twilioFrom] =
    await Promise.all([
      orgApiKey("ANTHROPIC_API_KEY", org),
      orgApiKey("SAM_API_KEY", org),
      orgApiKey("GOOGLE_MAPS_API_KEY", org),
      orgApiKey("HUNTER_API_KEY", org),
      orgApiKey("AHREFS_API_KEY", org),
      orgApiKey("TWILIO_ACCOUNT_SID", org),
      orgApiKey("TWILIO_AUTH_TOKEN", org),
      orgApiKey("TWILIO_FROM_NUMBER", org),
    ]);
  return {
    claude: claude.length > 0,
    sam: sam.length > 0,
    googleMaps: googleMaps.length > 0,
    hunter: hunter.length > 0,
    ahrefs: ahrefs.length > 0,
    twilio: Boolean(twilioSid && twilioToken && twilioFrom),
  };
}
