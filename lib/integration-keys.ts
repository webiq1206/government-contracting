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

  // Resolution order, and the order matters:
  //   1. The organization's own key. Always wins, even over a grant or a
  //      trial allowance, because a customer who has supplied a credential
  //      should be spending on it rather than on us.
  //   2. An explicit grant of the platform key to THIS organization.
  //   3. A trial allowance, while the trial is live and within budget.
  //   4. The environment, for the founding organization only.
  //   5. Nothing. An empty string disables the integration rather than
  //      quietly charging us for a customer's usage.
  let borrowed = false;
  if (!value && org !== LEGACY_ORG_ID && (await hasPlatformGrant(key, org))) {
    value = process.env[key]?.trim() ?? "";
    borrowed = value.length > 0;
  }
  if (!value && org !== LEGACY_ORG_ID && (await trialMayBorrow(key, org))) {
    value = process.env[key]?.trim() ?? "";
    borrowed = value.length > 0;
  }
  // Metered only when the credential is OURS. An organization spending on its
  // own key is never counted, which is the behaviour we want to encourage.
  if (borrowed) await recordPlatformKeyUse(key, org);
  if (!value && org === LEGACY_ORG_ID) {
    value = process.env[key]?.trim() ?? "";
  }

  cache.set(cacheKey, { value, at: Date.now() });
  return value;
}

/**
 * Whether this organization has been explicitly lent the platform's key.
 *
 * Expired grants are ignored here rather than swept, so a grant with an end
 * date stops working on time even if nothing has run since.
 */
async function hasPlatformGrant(key: AllowedEnvKey, orgId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `select true as ok from platform_key_grants
      where org_id = $1 and env_key = $2
        and (expires_at is null or expires_at > now())`,
    [orgId, key]
  ).catch(() => null);
  return row !== null;
}

/**
 * Whether a live trial may borrow this key and still has budget.
 *
 * Both halves are checked on every resolution rather than swept: a trial that
 * ended an hour ago stops borrowing immediately, and a budget crossed mid-run
 * stops the next call rather than the next day.
 */
async function trialMayBorrow(key: AllowedEnvKey, orgId: string): Promise<boolean> {
  const { isLendableDuringTrial, TRIAL_PLATFORM_KEY_BUDGET } = await import(
    "./billing/trial-keys"
  );
  if (!isLendableDuringTrial(key)) return false;

  const org = await queryOne<{ subscription_status: string; trial_ends_at: string | null }>(
    `select subscription_status, trial_ends_at::text as trial_ends_at
       from organizations where id = $1`,
    [orgId]
  ).catch(() => null);
  if (!org) return false;

  const { accessLevel } = await import("./billing/entitlements");
  if (accessLevel(org) !== "trial") return false;

  const budget = TRIAL_PLATFORM_KEY_BUDGET[key] ?? 0;
  const used = await queryOne<{ calls: number }>(
    `select calls from platform_key_usage where org_id = $1 and env_key = $2`,
    [orgId, key]
  ).catch(() => null);
  return (used?.calls ?? 0) < budget;
}

/** Count one call made on a platform credential. */
async function recordPlatformKeyUse(key: AllowedEnvKey, orgId: string): Promise<void> {
  const { query } = await import("./db");
  await query(
    `insert into platform_key_usage (org_id, env_key, calls)
     values ($1, $2, 1)
     on conflict (org_id, env_key)
       do update set calls = platform_key_usage.calls + 1, last_used = now()`,
    [orgId, key]
  ).catch(() => {});
}

/** Borrowed-key consumption for an organization, for the UI and admin views. */
export async function platformKeyUsage(
  orgId: string
): Promise<{ env_key: string; calls: number; budget: number; exhausted: boolean }[]> {
  const { query } = await import("./db");
  const { TRIAL_PLATFORM_KEY_BUDGET } = await import("./billing/trial-keys");
  const rows = await query<{ env_key: string; calls: number }>(
    `select env_key, calls from platform_key_usage where org_id = $1`,
    [orgId]
  ).catch(() => []);
  return rows.map((r) => {
    const budget = TRIAL_PLATFORM_KEY_BUDGET[r.env_key as AllowedEnvKey] ?? 0;
    return { ...r, budget, exhausted: budget > 0 && r.calls >= budget };
  });
}

export interface PlatformGrant {
  org_id: string;
  org_name: string | null;
  env_key: string;
  granted_at: string;
  expires_at: string | null;
  note: string | null;
}

/** Every live grant, for the admin screen that manages them. */
export async function listPlatformGrants(): Promise<PlatformGrant[]> {
  const { query } = await import("./db");
  return query<PlatformGrant>(
    `select g.org_id::text as org_id, o.name as org_name, g.env_key,
            g.granted_at::text as granted_at, g.expires_at::text as expires_at, g.note
       from platform_key_grants g
       left join organizations o on o.id = g.org_id
      order by g.granted_at desc`
  ).catch(() => []);
}

/** Lend one platform key to one organization. Overwrites an existing grant. */
export async function grantPlatformKey(input: {
  orgId: string;
  key: AllowedEnvKey;
  grantedBy: string | null;
  note?: string | null;
  expiresAt?: string | null;
}): Promise<void> {
  const { query } = await import("./db");
  await query(
    `insert into platform_key_grants (org_id, env_key, granted_by, note, expires_at)
     values ($1,$2,$3,$4,$5)
     on conflict (org_id, env_key) do update
       set granted_by = excluded.granted_by,
           granted_at = now(),
           note = excluded.note,
           expires_at = excluded.expires_at`,
    [input.orgId, input.key, input.grantedBy, input.note ?? null, input.expiresAt ?? null]
  );
  clearIntegrationKeyCache();
}

/** Take a lent key back. The organization falls straight back to its own. */
export async function revokePlatformKey(orgId: string, key: AllowedEnvKey): Promise<void> {
  const { query } = await import("./db");
  await query(
    `delete from platform_key_grants where org_id = $1 and env_key = $2`,
    [orgId, key]
  );
  clearIntegrationKeyCache();
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
