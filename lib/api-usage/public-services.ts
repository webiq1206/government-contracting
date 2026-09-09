import { randomUUID } from "node:crypto";
import { currentOrgId } from "../tenant-context";
import { query } from "../db";
/** Public data calls consume quota, but have no per-request provider charge. */
export async function observePublicService<T>(
  provider: string,
  service: string,
  execute: () => Promise<T>,
): Promise<T> {
  const orgId = currentOrgId();
  // Platform maintenance without a tenant is not assigned to the founding account.
  if (!orgId) return execute();
  const id = randomUUID();
  await query(
    `insert into api_usage_events(id,org_id,provider,service,feature,credential_source,credential_fingerprint,billing_status,provider_cost,evidence)
  values($1,$2,$3,$4,'Public data lookup','unknown','public data API','not_billable',0,'Public endpoint; no per-request provider charge')`,
    [id, orgId, provider, service],
  );
  let result: T;
  try {
    result = await execute();
  } catch (e) {
    await query(
      "update api_usage_events set outcome='failed',finished_at=now(),usage='{\"requests\":1}',error_code='Public data request failed' where id=$1",
      [id],
    ).catch(() => {});
    throw e;
  }
  await query(
    "update api_usage_events set outcome='success',finished_at=now(),usage='{\"requests\":1}' where id=$1",
    [id],
  ).catch(() =>
    console.error(
      "[api-usage] Public request completed; ledger completion needs review",
      id,
    ),
  );
  return result;
}
