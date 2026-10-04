import { createHash, randomUUID } from "node:crypto";
import { queryOne, transaction } from "../db";
import { apiUsageContext } from "../api-usage/context";
import { resolveTenantOrgId } from "../tenant";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** A later sweep cannot replay unresolved paid work, even with changed input. */
export async function withAiWorkReceipt<T>(input: unknown, execute: () => Promise<T>): Promise<T> {
  const org = await resolveTenantOrgId();
  const context = apiUsageContext();
  const inputHash = hash(input);
  // Record jobs share a reconciliation scope across changing input. A mailbox
  // sweep has no single record: independent messages use separate input scopes.
  const scope = hash([context.workKey, context.relatedId ?? inputHash]);
  const key = hash([scope, inputHash]);
  const owner = randomUUID();
  const hold = (cause?: unknown) => Object.assign(new Error(
    "AI work has an unresolved completion. Reconcile its saved output before retrying; no paid replay is allowed.", { cause }), { retryable: false });
  const admitted = await transaction(async client => {
    const lock = await client.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired", [JSON.stringify([org,scope])]);
    if (!lock.rows[0]?.acquired) throw hold();
    const prior = (await client.query<{state:string;result:T}>("select state,result from ai_work_receipts where org_id=$1 and work_key=$2",[org,key])).rows[0];
    const pending = await client.query("select owner from ai_work_receipts where org_id=$1 and scope_key=$2 and state='pending' limit 1",[org,scope]);
    if (pending.rows.length) throw hold();
    if (prior?.state === "complete") return {cached:true as const,result:prior.result};
    await client.query(`insert into ai_work_receipts(org_id,work_key,scope_key,input_hash,owner,state)
      values($1,$2,$3,$4,$5,'pending') on conflict(org_id,work_key) do update
      set owner=excluded.owner,state='pending',started_at=now()`,[org,key,scope,inputHash,owner]);
    return {cached:false as const};
  });
  if (admitted.cached) return admitted.result;
  let result:T;
  try { result=await execute(); } catch(error) {
    const e=error as {name?:string;reason?:string;status?:number;retryable?:boolean;handoffUncertain?:boolean};
    const local = ['ApiUsageBlockedError','ClaudeNotConfiguredError','ProviderAttemptBusyError','ProviderRefusalError'].includes(e.name ?? '');
    const refusal = ['AiUnavailableError','ClaudeUnavailableError','OpenAiUnavailableError'].includes(e.name ?? '') && e.handoffUncertain !== true && !!e.reason && [400,401,403,404,413,422,429].includes(e.status ?? 0);
    if (local || refusal) {
      await queryOne(`update ai_work_receipts set state='retryable' where org_id=$1 and work_key=$2 and owner=$3 returning owner`,[org,key,owner]);
      throw error;
    }
    // A timeout, HTTP 5xx, or lost completion ACK can follow a billed request.
    throw hold(error);
  }
  try {
    const saved=await queryOne(`update ai_work_receipts set state='complete',result=$4::jsonb,completed_at=now()
      where org_id=$1 and work_key=$2 and owner=$3 and state='pending' returning owner`,[org,key,owner,JSON.stringify(result)]);
    if (!saved) throw hold();
  } catch(error) { throw hold(error); }
  return result;
}
