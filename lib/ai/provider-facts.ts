import { createHash, randomUUID } from "node:crypto";
import { queryOne, transaction } from "../db";
import type { RequestIdentity } from "../api-usage/ledger";
import { ENV_KEY_FOR, type AiProvider, type AiTier } from "./routing";

export interface ProviderFacts {
  pending_attempt?: string | null;
  pending_started_at?: Date | null;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  failure_reason: string | null;
  failure_status: number | null;
  refusal_reason: string | null;
  refusal_status: number | null;
}

/** Shared platform keys share an account hold. Tenant keys never share it. */
export function providerScope(identity: RequestIdentity, provider: AiProvider): string[] {
  return [identity.source === "platform" ? "platform" : `${identity.source}:${identity.orgId}`,
    provider, createHash("sha256").update(identity.value).digest("hex")];
}

export class ProviderRefusalError extends Error {
  readonly retryable = false;
  constructor(readonly provider: AiProvider, readonly reason: string, readonly status: number | null) {
    super(`AI_UNAVAILABLE: ${reason}`);
    this.name = "ProviderRefusalError";
  }
}

export async function readProviderFacts(identity: RequestIdentity, provider: AiProvider): Promise<ProviderFacts | null> {
  return queryOne<ProviderFacts>(`select * from ai_provider_facts
    where account_scope=$1 and provider=$2 and credential_hash=$3`, providerScope(identity, provider));
}

export async function currentProviderEvidence(provider: AiProvider, orgId?: string): Promise<{ facts: ProviderFacts | null; configured: boolean; source: RequestIdentity["source"] | null }> {
  const { orgApiKey } = await import("../integration-keys");
  const { requestIdentity } = await import("../api-usage/ledger");
  const key = ENV_KEY_FOR[provider];
  const value = await orgApiKey(key, orgId);
  if (!value) return { facts: null, configured: false, source: null };
  const identity = await requestIdentity(key, value, orgId);
  return { facts: await readProviderFacts(identity, provider), configured: true, source: identity.source };
}

export async function currentProviderFacts(provider: AiProvider, orgId?: string): Promise<ProviderFacts | null> {
  return (await currentProviderEvidence(provider, orgId)).facts;
}

/** Latest failure stays visible until a genuinely newer success, without a TTL. */
export function providerProblem(f: ProviderFacts | null): string | null {
  if (!f) return null;
  if (f.pending_attempt) return "A provider request is in progress or has an unresolved outcome. Recovery requires reconciliation if its worker stopped.";
  if (f.refusal_reason) return f.refusal_reason;
  return f.last_failure_at && (!f.last_success_at || +new Date(f.last_failure_at) >= +new Date(f.last_success_at))
    ? f.failure_reason : null;
}

export async function providerRouteRefusal(orgId: string, tier: AiTier, includePending = false): Promise<ProviderRefusalError | null> {
  const { planRoute } = await import("./claude");
  const plan = await planRoute({ complexity: tier }, orgId);
  if (!plan) return null;
  const primary = await currentProviderFacts(plan.primary.provider, orgId);
  const held = (facts: ProviderFacts | null) => facts?.refusal_reason || (includePending && facts?.pending_attempt ? providerProblem(facts) : null);
  const reason = held(primary);
  if (!reason) return null;
  if (plan.fallback && !held(await currentProviderFacts(plan.fallback.provider, orgId))) return null;
  return new ProviderRefusalError(plan.primary.provider, reason, primary?.refusal_status ?? null);
}

export async function providerEnqueueHold(orgId: string, tier: AiTier): Promise<string | null> {
  return (await providerRouteRefusal(orgId, tier, true))?.message ?? null;
}

/**
 * Commit an attempt token before I/O, then release the database connection.
 * Tokens never expire: a stopped worker or failed evidence write leaves an
 * unresolved hold, even for explicit recovery tests. Clearing that hold needs
 * reconciliation, not a timer that could overlap an unknown/billed request.
 */
export async function withProviderFacts<T>(identity: RequestIdentity, provider: AiProvider,
  execute: () => Promise<T>, recoveryTest = false): Promise<T> {
  const scope = providerScope(identity, provider);
  const attempt = randomUUID();
  const busy = () => Object.assign(new Error(`AI_UNAVAILABLE: ${provider} has a request in progress or an unresolved outcome. Retry only after it completes or is reconciled.`),
    { provider, retryable: true });
  await transaction(async client => {
    const lock = await client.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired", [JSON.stringify(scope)]);
    if (!lock.rows[0]?.acquired) throw busy();
    const row = (await client.query<ProviderFacts>(`select * from ai_provider_facts
      where account_scope=$1 and provider=$2 and credential_hash=$3`, scope)).rows[0];
    if (row?.pending_attempt) throw busy();
    if (row?.refusal_reason && !recoveryTest) {
      throw new ProviderRefusalError(provider, row.refusal_reason, row.refusal_status);
    }
    await client.query(`insert into ai_provider_facts(account_scope,provider,credential_hash,pending_attempt,pending_started_at)
      values($1,$2,$3,$4,clock_timestamp()) on conflict(account_scope,provider,credential_hash) do update
      set pending_attempt=excluded.pending_attempt,pending_started_at=excluded.pending_started_at`, [...scope, attempt]);
  });

  // Do not catch completion persistence errors as if they were provider errors.
  // An uncertain claim commit also never reaches execute().
  let outcome: { value: T } | { error: unknown };
  try { outcome = { value: await execute() }; }
  catch (error) { outcome = { error }; }
  const success = "value" in outcome;
  const e = "error" in outcome ? outcome.error as { provider?: string; retryable?: boolean; reason?: string; status?: number | null } : null;
  const observed = e?.provider === provider && typeof e.retryable === "boolean" && Boolean(e.reason);
  const reason = observed ? e!.reason! : null;
  const status = observed ? e!.status ?? null : null;
  const permanent = observed && e!.retryable === false;
  const saved = await queryOne<{ saved: boolean }>(`update ai_provider_facts set
    last_success_at=case when $5 then clock_timestamp() else last_success_at end,
    last_failure_at=case when $6::text is not null then clock_timestamp() else last_failure_at end,
    failure_reason=coalesce($6,failure_reason),
    failure_status=case when $6::text is not null then $7::integer else failure_status end,
    refusal_reason=case when $5 then null when $8 then $6 else refusal_reason end,
    refusal_status=case when $5 then null when $8 then $7::integer else refusal_status end,
    pending_attempt=null,pending_started_at=null
    where account_scope=$1 and provider=$2 and credential_hash=$3 and pending_attempt=$4
    returning true as saved`, [...scope, attempt, success, reason, status, permanent]);
  if (!saved) throw new Error("Provider attempt ownership changed; completion needs reconciliation.");
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
