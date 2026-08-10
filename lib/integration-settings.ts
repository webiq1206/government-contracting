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

export const ALLOWED_ENV_KEYS = [
  "SAM_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "HUNTER_API_KEY",
  "BLS_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "RESEND_OUTREACH_FROM",
  "RESEND_WEBHOOK_SECRET",
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

export async function listSettings(): Promise<StoredSetting[]> {
  const rows = await query<{
    env_key: string;
    value_enc: string;
    updated_at: string;
    last_validated_at: string | null;
    last_error: string | null;
  }>(`select * from integration_settings`);
  return rows.map((r) => ({
    env_key: r.env_key,
    value: decryptSecret(r.value_enc),
    updated_at: r.updated_at,
    last_validated_at: r.last_validated_at,
    last_error: r.last_error,
  }));
}

export async function saveSetting(key: AllowedEnvKey, value: string): Promise<void> {
  await query(
    `insert into integration_settings (env_key, value_enc, updated_at)
     values ($1, $2, now())
     on conflict (env_key) do update set value_enc = excluded.value_enc, updated_at = now()`,
    [key, encryptSecret(value)]
  );
  await hydrateIntegrationEnv();
}

export async function deleteSetting(key: AllowedEnvKey): Promise<void> {
  await query(`delete from integration_settings where env_key = $1`, [key]);
  await hydrateIntegrationEnv();
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
      where env_key = $1`,
    [key, ok, ok ? null : (error ?? "Validation failed.")]
  );
}

/**
 * Load every UI-saved value into process.env (UI value wins over env), and
 * restore the original env value when a UI value is removed. Safe to call
 * often; failures degrade to env-only config.
 */
const envBaseline = new Map<string, string | undefined>();

export async function hydrateIntegrationEnv(): Promise<void> {
  try {
    const rows = await listSettings();
    const byKey = new Map(rows.map((r) => [r.env_key, r.value]));
    for (const key of ALLOWED_ENV_KEYS) {
      if (!envBaseline.has(key)) envBaseline.set(key, process.env[key]);
      const uiValue = byKey.get(key);
      if (uiValue) {
        process.env[key] = uiValue;
      } else {
        const original = envBaseline.get(key);
        if (original == null) delete process.env[key];
        else process.env[key] = original;
      }
    }
  } catch (err) {
    console.error("[integration-settings] hydrate failed:", (err as Error).message);
  }
}

/** Which source currently provides each key (for the Integrations page). */
export async function settingSources(): Promise<
  Record<string, { source: "ui" | "env" | "none"; masked: string | null; updated_at?: string; last_validated_at?: string | null; last_error?: string | null }>
> {
  const rows = await listSettings();
  const byKey = new Map(rows.map((r) => [r.env_key, r]));
  const out: Record<string, { source: "ui" | "env" | "none"; masked: string | null; updated_at?: string; last_validated_at?: string | null; last_error?: string | null }> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    if (!envBaseline.has(key)) envBaseline.set(key, process.env[key]);
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
      const envVal = envBaseline.get(key);
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
