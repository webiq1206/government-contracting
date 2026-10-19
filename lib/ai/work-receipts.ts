import { createHash, randomUUID } from "node:crypto";
import { queryOne, transaction } from "../db";
import { apiUsageContext } from "../api-usage/context";
import { resolveTenantOrgId } from "../tenant";
import { eligibleForFailover } from "./failover-policy";
import { AI_RECEIPT_TTL_MS } from "../domain/hold-registry";
import type { AiProvider } from "./routing";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * The sentence every hold on unsettled AI work carries. Automation Health
 * classifies on it, so change it there as well.
 */
export const RECEIPT_HOLD_MESSAGE =
  "AI work for this record is waiting on an earlier attempt that has not settled. " +
  "It was not replayed. The lease on that attempt ends about 25 minutes after it started, " +
  "and the next scheduled run retries the work on its own after that.";

/** A hold is a short lease, never a permanent stop: it reports as transient. */
export function receiptHoldError(cause?: unknown): Error & { retryable: false; transientHold: true } {
  return Object.assign(new Error(RECEIPT_HOLD_MESSAGE, cause === undefined ? undefined : { cause }),
    { retryable: false as const, transientHold: true as const });
}

/**
 * One billed attempt per logical work item at a time.
 *
 * A receipt is pending from just before the provider call until its result
 * is saved. While it is pending, no sweep, manual run or recovery job may
 * start the same work again: that is how a lost completion ACK used to get
 * billed twice. The lease is bounded. A receipt older than AI_RECEIPT_TTL_MS
 * cannot still be on the wire (each client aborts at AI_CALL_TIMEOUT_MS and a
 * receipt covers at most a primary and a fallback call), so admission expires
 * it and takes the work over. Before that expiry existed, one interrupted call
 * held its record forever and every later run was refused as unresolved.
 */
export async function withAiWorkReceipt<T>(input: unknown, execute: () => Promise<T>, rollout?: {
  logicalInput: unknown; enableProviderIndependent: boolean;
}): Promise<T> {
  const org = await resolveTenantOrgId();
  const context = apiUsageContext();
  let inputHash = hash(input);
  // Record jobs share a reconciliation scope across changing input. A mailbox
  // sweep has no single record: independent messages use separate input scopes.
  let scope = hash([context.workKey, context.relatedId ?? inputHash]);
  let key = hash([scope, inputHash]);
  const owner = randomUUID();
  const hold = (cause?: unknown) => receiptHoldError(cause);
  const admitted = await transaction(async client => {
    // Expire leases that outlived the longest possible call. The attempt they
    // protected is over, settled or not, and the row no longer guards a live
    // request. Done first so every check below sees only live leases.
    await client.query(`update ai_work_receipts set state='retryable'
      where org_id=$1 and state='pending'
        and started_at <= clock_timestamp() - ($2::bigint * interval '1 millisecond')`, [org, AI_RECEIPT_TTL_MS]);
    let providerIndependent = false;
    if (rollout) {
      // Deploy this dual reader with the switch OFF and drain pre-reader
      // executors before enabling it. All dual readers share the transition
      // lock and retain v2 identity even after a flag/configuration rollback.
      const transition = await client.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired", [JSON.stringify([org,"ai-receipt-transition"])]);
      if (!transition.rows[0]?.acquired) throw hold();
      const existing = await client.query("select 1 from ai_work_receipts where org_id=$1 and scope_key like 'v2:%' limit 1", [org]);
      providerIndependent = rollout.enableProviderIndependent || existing.rows.length > 0;
      if (providerIndependent) {
        inputHash = hash(rollout.logicalInput);
        scope = `v2:${hash([context.workKey, context.relatedId ?? "tenant-work"])}`;
        key = hash([scope, inputHash]);
      }
    }
    // Older rows did not retain a provider-independent operation identity, so
    // a legacy call still inside its lease may be the very work being asked
    // for. Wait for that lease. A legacy row that already completed is a
    // saved answer under a key nothing reads any more; redoing that work once
    // is a one-time cost, not a second bill for a call still in flight.
    if (providerIndependent) {
      const legacy = await client.query(`select 1 from ai_work_receipts
        where org_id=$1 and scope_key not like 'v2:%' and state='pending' limit 1`, [org]);
      if (legacy.rows.length) throw Object.assign(new Error(
        "AI failover is held: an earlier work receipt is still inside its lease. Provider-independent routing begins once it ends."),
        { retryable: false, transientHold: true });
      // Incidental queue/manual/recovery payload changes must not reopen an
      // unresolved tenant-wide operation under a different workKey either.
      const pendingTenant = await client.query("select 1 from ai_work_receipts where org_id=$1 and scope_key like 'v2:%' and state='pending' limit 1", [org]);
      if (pendingTenant.rows.length) throw hold();
    }
    const lock = await client.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired", [JSON.stringify([org,scope])]);
    if (!lock.rows[0]?.acquired) throw hold();
    const prior = (await client.query<{state:string;result:T}>("select state,result from ai_work_receipts where org_id=$1 and work_key=$2",[org,key])).rows[0];
    const pending = await client.query("select owner from ai_work_receipts where org_id=$1 and scope_key=$2 and state='pending' limit 1",[org,scope]);
    if (pending.rows.length) throw hold();
    if (prior?.state === "complete") return {cached:true as const,result:prior.result};
    await client.query(`insert into ai_work_receipts(org_id,work_key,scope_key,input_hash,owner,state,started_at,completed_at)
      values($1,$2,$3,$4,$5,'pending',clock_timestamp(),null) on conflict(org_id,work_key) do update
      set owner=excluded.owner,state='pending',started_at=clock_timestamp(),completed_at=null`,[org,key,scope,inputHash,owner]);
    return {cached:false as const};
  });
  if (admitted.cached) return admitted.result;
  let result:T;
  try { result=await execute(); } catch(error) {
    const e=error as {name?:string;provider?:AiProvider;reason?:string;status?:number;retryable?:boolean;handoffUncertain?:boolean};
    const local = ['ApiUsageBlockedError','ProspectiveBlockedError','ClaudeNotConfiguredError','ProviderAttemptBusyError','ProviderRefusalError'].includes(e.name ?? '');
    const refusal = ['AiUnavailableError','ClaudeUnavailableError','OpenAiUnavailableError'].includes(e.name ?? '') && e.handoffUncertain !== true && !!e.reason &&
      ([400,401,403,404,413,422,429].includes(e.status ?? 0) ||
        (e.handoffUncertain === false && !!e.provider && eligibleForFailover(e.provider, e.status ?? null, e.reason)));
    if (local || refusal) {
      await queryOne(`update ai_work_receipts set state='retryable' where org_id=$1 and work_key=$2 and owner=$3 returning owner`,[org,key,owner]);
      throw error;
    }
    // A timeout, HTTP 5xx, or lost completion ACK can follow a billed request.
    // The receipt stays pending for the rest of its lease, then expires.
    throw hold(error);
  }
  try {
    const saved=await queryOne(`update ai_work_receipts set state='complete',result=$4::jsonb,completed_at=now()
      where org_id=$1 and work_key=$2 and owner=$3 and state='pending' returning owner`,[org,key,owner,JSON.stringify(result)]);
    if (!saved) throw hold();
  } catch(error) { throw hold(error); }
  return result;
}
