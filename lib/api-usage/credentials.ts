import { queryOne } from "../db";
import { decryptSecret } from "../integration-settings";
import { LEGACY_ORG_ID } from "../tenant-context";
/** The platform may keep its credential encrypted in Settings or in the deployment environment. */
export async function platformApiValue(key: string): Promise<string> {
  const row = await queryOne<{ value_enc: string }>(
    "select value_enc from integration_settings where org_id=$1 and env_key=$2",
    [LEGACY_ORG_ID, key],
  );
  if (row) {
    const value = decryptSecret(row.value_enc);
    if (!value)
      throw new Error("The platform API key needs to be reconnected.");
    return value;
  }
  return process.env[key]?.trim() ?? "";
}
