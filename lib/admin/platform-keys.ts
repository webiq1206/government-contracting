/**
 * The admin view of lending a platform credential to one customer.
 *
 * The grant table, the resolution order, and the trial meter all existed
 * already (051, 052, lib/integration-keys.ts). What did not exist was any way
 * to see or change a grant: they could only be created by hand in SQL, which
 * meant nobody could answer "whose spend is on our key right now" without
 * opening a database client. This is that view, and the two actions that go
 * with it.
 *
 * Cross-tenant, so it lives in lib/admin and nothing here is reachable without
 * requirePlatformAdmin.
 */
import { query, queryOne } from "../db";
import {
  grantPlatformKey,
  revokePlatformKey,
  platformKeyUsage,
} from "../integration-keys";
import type { AllowedEnvKey } from "../integration-settings";
import { TRIAL_PLATFORM_KEY_BUDGET, isLendableDuringTrial } from "../billing/trial-keys";
import { recordAdminAction } from "./audit";
import type { AdminActionResult } from "./accounts";

/**
 * Credentials that can sensibly be lent, and what each one buys.
 *
 * Only metered, pay-per-call data credentials are here. The rest of
 * ALLOWED_ENV_KEYS is deliberately absent: Twilio and Gmail are an identity
 * rather than a quota, and sending a subcontractor an SMS from our number or
 * an email from our mailbox misattributes the message to us and cannot be
 * taken back. Lending those is not a billing decision, it is impersonation, so
 * the UI does not offer it.
 */
export const LENDABLE_KEYS: {
  key: AllowedEnvKey;
  label: string;
  powers: string;
  /**
   * Set when lending has a consequence beyond our bill. Shown as a warning the
   * admin has to read past rather than a note beside the button.
   */
  hazard?: string;
}[] = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic (Claude)",
    powers: "Opportunity scoring, solicitation analysis, bid briefs, reply reading.",
  },
  {
    key: "GOOGLE_MAPS_API_KEY",
    label: "Google Maps (Places)",
    powers: "Finding and enriching subcontractors.",
  },
  {
    key: "SAM_API_KEY",
    label: "SAM.gov",
    powers: "Federal opportunity ingestion, entity and exclusion lookups.",
    hazard:
      "A public SAM key is rate limited near 1,000 requests a day and the " +
      "opportunity monitor alone asks for roughly 1,800 per organization. " +
      "Lending this does not just cost money, it exhausts the shared quota " +
      "and stops ingestion for every other borrower and for us. It is also " +
      "the one credential a contractor must already hold to bid at all. Lend " +
      "it only to an account genuinely waiting on SAM to issue theirs, and " +
      "set an expiry.",
  },
  {
    key: "HUNTER_API_KEY",
    label: "Hunter",
    powers: "Finding subcontractor contact emails.",
  },
  {
    key: "AHREFS_API_KEY",
    label: "Ahrefs",
    powers: "Backlink and authority research.",
  },
  {
    key: "BLS_API_KEY",
    label: "Bureau of Labor Statistics",
    powers: "Wage data behind pricing research.",
  },
];

export interface PlatformKeyState {
  key: AllowedEnvKey;
  label: string;
  powers: string;
  hazard: string | null;
  /** They have entered their own credential, so a grant would change nothing. */
  hasOwnKey: boolean;
  /** We have this key at all. Granting one we do not hold lends an empty string. */
  platformHasKey: boolean;
  grantedAt: string | null;
  expiresAt: string | null;
  /** A grant past its expiry is inert, and says so rather than disappearing. */
  expired: boolean;
  note: string | null;
  grantedByEmail: string | null;
  /** Calls already made on our credential, whether by grant or trial. */
  calls: number;
  /** Trial allowance for this key, 0 when it is never lent to trials. */
  trialBudget: number;
  lendableDuringTrial: boolean;
}

/**
 * Everything the admin screen needs about one account's use of our keys.
 *
 * Reads integration_settings directly rather than through orgApiKey, because
 * that function answers "what credential applies", which is exactly the wrong
 * question here: it would report a borrowed key as if the customer had one and
 * hide the fact that they are spending ours.
 */
export async function platformKeyStates(orgId: string): Promise<PlatformKeyState[]> {
  const [own, grants, usage] = await Promise.all([
    query<{ env_key: string }>(
      `select env_key from integration_settings
        where org_id = $1 and coalesce(btrim(value_enc), '') <> ''`,
      [orgId]
    ).catch(() => []),
    query<{
      env_key: string;
      granted_at: string;
      expires_at: string | null;
      note: string | null;
      granted_by_email: string | null;
    }>(
      `select g.env_key, g.granted_at::text as granted_at,
              g.expires_at::text as expires_at, g.note,
              u.email as granted_by_email
         from platform_key_grants g
         left join users u on u.id = g.granted_by
        where g.org_id = $1`,
      [orgId]
    ).catch(() => []),
    platformKeyUsage(orgId),
  ]);

  const ownKeys = new Set(own.map((r) => r.env_key));
  const grantByKey = new Map(grants.map((g) => [g.env_key, g]));
  const usageByKey = new Map(usage.map((u) => [u.env_key, u]));
  const now = Date.now();

  return LENDABLE_KEYS.map(({ key, label, powers, hazard }) => {
    const grant = grantByKey.get(key);
    return {
      key,
      label,
      powers,
      hazard: hazard ?? null,
      hasOwnKey: ownKeys.has(key),
      platformHasKey: (process.env[key]?.trim() ?? "").length > 0,
      grantedAt: grant?.granted_at ?? null,
      expiresAt: grant?.expires_at ?? null,
      expired: Boolean(grant?.expires_at && new Date(grant.expires_at).getTime() <= now),
      note: grant?.note ?? null,
      grantedByEmail: grant?.granted_by_email ?? null,
      calls: usageByKey.get(key)?.calls ?? 0,
      trialBudget: TRIAL_PLATFORM_KEY_BUDGET[key] ?? 0,
      lendableDuringTrial: isLendableDuringTrial(key),
    };
  });
}

function lendable(key: string): (typeof LENDABLE_KEYS)[number] | undefined {
  return LENDABLE_KEYS.find((k) => k.key === key);
}

/**
 * Lend one credential to one account.
 *
 * The expiry is a string date from a form, so it is validated here rather than
 * trusted: a grant that silently failed to parse its end date would run
 * forever, which is the exact failure the column was added to prevent.
 */
export async function grantKeyToAccount(input: {
  orgId: string;
  key: string;
  note: string;
  expiresAt: string | null;
  adminEmail: string;
  adminUserId: string | null;
}): Promise<AdminActionResult> {
  const entry = lendable(input.key);
  if (!entry) {
    return { ok: false, error: "That credential cannot be lent from here." };
  }

  const org = await queryOne<{ name: string }>(
    `select name from organizations where id = $1`,
    [input.orgId]
  );
  if (!org) return { ok: false, error: "That account no longer exists." };

  if ((process.env[entry.key]?.trim() ?? "") === "") {
    return {
      ok: false,
      error: `There is no platform ${entry.label} key to lend. Set it in the environment first.`,
    };
  }

  let expires: string | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "That expiry date could not be read." };
    }
    if (parsed.getTime() <= Date.now()) {
      return { ok: false, error: "That expiry is in the past, so the grant would do nothing." };
    }
    expires = parsed.toISOString();
  }

  // Why, in the granter's words, is read months later when deciding whether to
  // revoke. A grant with no reason is one nobody can safely take back.
  const note = input.note.trim();
  if (!note) {
    return { ok: false, error: "Say why this account is being lent our key." };
  }

  await grantPlatformKey({
    orgId: input.orgId,
    key: entry.key,
    grantedBy: input.adminUserId,
    note,
    expiresAt: expires,
  });

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "platform_key_granted",
    orgId: input.orgId,
    orgName: org.name,
    detail: { env_key: entry.key, reason: note, expires_at: expires },
  });

  return {
    ok: true,
    message: expires
      ? `${org.name} is using our ${entry.label} key until ${new Date(expires).toLocaleDateString("en-US")}.`
      : `${org.name} is using our ${entry.label} key, with no expiry.`,
  };
}

/** Take a lent credential back. They fall straight back to their own, or to nothing. */
export async function revokeKeyFromAccount(input: {
  orgId: string;
  key: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const entry = lendable(input.key);
  if (!entry) return { ok: false, error: "That credential cannot be lent from here." };

  const org = await queryOne<{ name: string }>(
    `select name from organizations where id = $1`,
    [input.orgId]
  );
  if (!org) return { ok: false, error: "That account no longer exists." };

  await revokePlatformKey(input.orgId, entry.key);
  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "platform_key_revoked",
    orgId: input.orgId,
    orgName: org.name,
    detail: { env_key: entry.key },
  });

  return {
    ok: true,
    message: `${org.name} no longer uses our ${entry.label} key.`,
  };
}
