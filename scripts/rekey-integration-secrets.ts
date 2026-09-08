/**
 * Move every stored credential onto the current AUTH_SECRET.
 *
 * Run once after a secret change, from the release job:
 *
 *   AUTH_SECRET_PREVIOUS=<old> MIGRATION_DATABASE_URL=<owner> npm run db:rekey-secrets
 *
 * Reads each integration_settings value and each Gmail refresh token under
 * every secret the deployment holds (AUTH_SECRET, AUTH_SECRET_PREVIOUS,
 * SESSION_SECRET), and rewrites the ones that are readable but not under the
 * primary. Rows already under the primary are left alone, legacy plaintext
 * rows are left alone (their readers handle them), and a row that no secret
 * can read is listed by key and organization so the operator knows exactly
 * which credential to re-enter. Nothing is printed but keys, counts, and
 * organization ids.
 *
 * Idempotent: a second run finds nothing to move.
 */
import { config } from "../lib/config";
import { standaloneClient } from "../lib/db";
import {
  candidateSecrets,
  decryptSecret,
  encryptSecret,
  isUnderPrimarySecret,
} from "../lib/integration-settings";

function readable(stored: string): boolean {
  try {
    return decryptSecret(stored) !== null;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const dedicatedUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!dedicatedUrl && config.isProd && !config.database.isIsolatedDev) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required to rekey production credentials. Run this from the release job with the owner connection."
    );
  }
  console.log(`[rekey] ${candidateSecrets().length} secret(s) available to read under.`);

  const client = standaloneClient({
    queryTimeoutMs: 60_000,
    applicationName: "brostco-rekey-secrets",
    connectionString: dedicatedUrl || config.database.url,
  });
  await client.connect();
  try {
    let moved = 0;
    let unreadable = 0;
    let current = 0;

    const settings = await client.query<{ org_id: string; env_key: string; value_enc: string }>(
      `select org_id::text as org_id, env_key, value_enc from integration_settings`
    );
    for (const row of settings.rows) {
      if (!row.value_enc.startsWith("v1:")) continue;
      if (isUnderPrimarySecret(row.value_enc)) {
        current++;
        continue;
      }
      if (!readable(row.value_enc)) {
        unreadable++;
        console.log(`[rekey] ! ${row.env_key} for org ${row.org_id}: unreadable under every secret; re-enter it in Settings > Integrations.`);
        continue;
      }
      const plain = decryptSecret(row.value_enc)!;
      await client.query(
        `update integration_settings set value_enc = $3 where org_id = $1 and env_key = $2`,
        [row.org_id, row.env_key, encryptSecret(plain)]
      );
      moved++;
      console.log(`[rekey] + ${row.env_key} for org ${row.org_id}: rewritten under the current secret.`);
    }

    const tokens = await client.query<{ org_id: string; provider: string; data: { refresh_token?: string } | null }>(
      `select org_id::text as org_id, provider, data from integration_tokens`
    );
    for (const row of tokens.rows) {
      const rt = row.data?.refresh_token;
      if (typeof rt !== "string" || !rt.startsWith("v1:")) continue;
      if (isUnderPrimarySecret(rt)) {
        current++;
        continue;
      }
      if (!readable(rt)) {
        unreadable++;
        console.log(`[rekey] ! ${row.provider} refresh token for org ${row.org_id}: unreadable under every secret; reconnect the mailbox.`);
        continue;
      }
      const plain = decryptSecret(rt)!;
      await client.query(
        `update integration_tokens set data = data || jsonb_build_object('refresh_token', $3::text) where org_id = $1 and provider = $2`,
        [row.org_id, row.provider, encryptSecret(plain)]
      );
      moved++;
      console.log(`[rekey] + ${row.provider} refresh token for org ${row.org_id}: rewritten under the current secret.`);
    }

    console.log(
      `[rekey] done: ${moved} rewritten, ${current} already current, ${unreadable} unreadable.` +
        (unreadable > 0 ? " Re-enter the unreadable ones; nothing else can recover them." : "")
    );
    if (unreadable > 0) process.exitCode = 2;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[rekey]", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
