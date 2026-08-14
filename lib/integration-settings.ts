/**
 * UI-managed integration credentials.
 *
 * Values are stored AES-256-GCM encrypted (key derived from AUTH_SECRET) in
 * the integration_settings table and hydrated into process.env so the
 * existing config getters and integration clients pick them up without any
 * signature changes. Precedence: UI-saved value > environment variable.
 *
 * Only keys in ALLOWED_ENV_KEYS can be managed from the UI. Infrastructure
 * secrets (DATABASE_URL, AUTH_SECRET, REDIS_URL, operator login) stay
 * env-only on purpose: a typo there could lock the whole platform out.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { LEGACY_ORG_ID } from "./tenant-context";
import { clearIntegrationKeyCache } from "./integration-keys";

/**
 * The organization whose settings are being read or written.
 *
 * Every function below is scoped to one organization. Before this, the table
 * was keyed by env_key alone and these queries carried no org filter, so the
 * second customer to save a SAM key overwrote the first and every tenant then
 * searched on one account's credential.
 */
async function settingsOrg(): Promise<string> {
  try {
    const { tryResolveTenantOrgId } = await import("./tenant");
    return (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  } catch {
    return LEGACY_ORG_ID;
  }
}

export const ALLOWED_ENV_KEYS = [
  "SAM_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "HUNTER_API_KEY",
  "BLS_API_KEY",
  "DIGEST_EMAIL_TO",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "ALERT_SMS_TO",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_SENDER",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AHREFS_API_KEY",
  "AHREFS_TARGET",
] as const;
export type AllowedEnvKey = (typeof ALLOWED_ENV_KEYS)[number];

export function isAllowedKey(key: string): key is AllowedEnvKey {
  return (ALLOWED_ENV_KEYS as readonly string[]).includes(key);
}

function encryptionKey(): Buffer {
  // Match config.auth.secret resolution (AUTH_SECRET, then SESSION_SECRET).
  const secret =
    process.env.AUTH_SECRET || process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
  return createHash("sha256").update(`integration-settings:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored: string): string | null {
  try {
    const [v, ivB64, tagB64, encB64] = stored.split(":");
    if (v !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong AUTH_SECRET or corrupted row: treat as unset rather than crash.
    return null;
  }
}

export interface StoredSetting {
  env_key: string;
  value: string | null; // decrypted
  updated_at: string;
  last_validated_at: string | null;
  last_error: string | null;
}

export async function listSettings(orgId?: string): Promise<StoredSetting[]> {
  const org = orgId ?? (await settingsOrg());
  const rows = await query<{
    env_key: string;
    value_enc: string;
    updated_at: string;
    last_validated_at: string | null;
    last_error: string | null;
  }>(`select * from integration_settings where org_id = $1`, [org]);
  return rows.map((r) => ({
    env_key: r.env_key,
    value: decryptSecret(r.value_enc),
    updated_at: r.updated_at,
    last_validated_at: r.last_validated_at,
    last_error: r.last_error,
  }));
}

export async function saveSetting(key: AllowedEnvKey, value: string): Promise<void> {
  const org = await settingsOrg();
  await query(
    `insert into integration_settings (env_key, org_id, value_enc, updated_at)
     values ($1, $2, $3, now())
     on conflict (env_key, org_id)
       do update set value_enc = excluded.value_enc, updated_at = now()`,
    [key, org, encryptSecret(value)]
  );
  clearIntegrationKeyCache();
}

export async function deleteSetting(key: AllowedEnvKey): Promise<void> {
  const org = await settingsOrg();
  await query(`delete from integration_settings where env_key = $1 and org_id = $2`, [key, org]);
  clearIntegrationKeyCache();
}

export async function recordValidation(
  key: AllowedEnvKey,
  ok: boolean,
  error?: string
): Promise<void> {
  await query(
    `update integration_settings
        set last_validated_at = case when $2 then now() else last_validated_at end,
            last_error = $3
      where env_key = $1 and org_id = $4`,
    [key, ok, ok ? null : (error ?? "Validation failed."), await settingsOrg()]
  );
}

/**
 * Retained as a no-op so the many call sites that awaited it keep working.
 *
 * This used to copy every UI-saved credential into `process.env` and refresh
 * it on a five-minute timer. process.env is process-global: one worker serves
 * every tenant's jobs and one server serves every tenant's requests, so the
 * effective SAM, Anthropic, and Maps keys for ALL organizations were whichever
 * tenant was hydrated most recently. Combined with a table keyed by env_key
 * alone, the second customer to save a key took over the first customer's
 * integrations entirely.
 *
 * Credentials are now resolved per organization at the point of use, through
 * `orgApiKey()` in lib/integration-keys.ts. Nothing is written to shared
 * process state. The call sites are left in place rather than removed so this
 * change cannot silently miss one: they are simply free now.
 */
export async function hydrateIntegrationEnv(): Promise<void> {
  /* Intentionally empty. See orgApiKey() in lib/integration-keys.ts. */
}

/** Which source currently provides each key (for the Integrations page). */
export async function settingSources(): Promise<
  Record<string, { source: "ui" | "env" | "none"; masked: string | null; updated_at?: string; last_validated_at?: string | null; last_error?: string | null }>
> {
  const org = await settingsOrg();
  const rows = await listSettings(org);
  const byKey = new Map(rows.map((r) => [r.env_key, r]));
  const out: Record<string, { source: "ui" | "env" | "none"; masked: string | null; updated_at?: string; last_validated_at?: string | null; last_error?: string | null }> = {};
  // Only the founding organization can be served by the environment. For a
  // customer, a key they have not entered reads as "none", never as the
  // platform's own credential quietly standing in for theirs.
  const envAllowed = org === LEGACY_ORG_ID;
  for (const key of ALLOWED_ENV_KEYS) {
    const row = byKey.get(key);
    if (row?.value) {
      out[key] = {
        source: "ui",
        masked: mask(row.value),
        updated_at: row.updated_at,
        last_validated_at: row.last_validated_at,
        last_error: row.last_error,
      };
    } else {
      const envVal = envAllowed ? process.env[key] : undefined;
      const isPlaceholder = envVal ? /^<[^>]*>$/.test(envVal.trim()) : true;
      out[key] =
        envVal && !isPlaceholder
          ? { source: "env", masked: mask(envVal) }
          : { source: "none", masked: null };
    }
  }
  return out;
}

function mask(v: string): string {
  if (v.length <= 6) return "•".repeat(v.length);
  return `${"•".repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
}
