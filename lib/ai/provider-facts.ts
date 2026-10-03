import { createHash } from "node:crypto";
import { queryOne, transaction } from "../db";
import type { RequestIdentity } from "../api-usage/ledger";
import { ENV_KEY_FOR, type AiProvider, type AiTier } from "./routing";

export interface ProviderFacts {
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
  if (f.refusal_reason) return f.refusal_reason;
  return f.last_failure_at && (!f.last_success_at || +new Date(f.last_failure_at) >= +new Date(f.last_success_at))
    ? f.failure_reason : null;
}

export async function providerRouteRefusal(orgId: string, tier: AiTier): Promise<ProviderRefusalError | null> {
  const { planRoute } = await import("./claude");
  const plan = await planRoute({ complexity: tier }, orgId);
  if (!plan) return null;
  const primary = await currentProviderFacts(plan.primary.provider, orgId);
  if (!primary?.refusal_reason) return null;
  if (plan.fallback && !(await currentProviderFacts(plan.fallback.provider, orgId))?.refusal_reason) return null;
  return new ProviderRefusalError(plan.primary.provider, primary.refusal_reason, primary.refusal_status);
}

export async function providerEnqueueHold(orgId: string, tier: AiTier): Promise<string | null> {
  return (await providerRouteRefusal(orgId, tier))?.message ?? null;
}

/**
 * Hold a non-waiting account lock through the request and evidence commit.
 * Other workers back off before metering/I/O. Returning the error from the
 * transaction (then throwing) is essential: throwing inside rolls back the
 * refusal. A deliberate connection test may probe recovery, with all existing
 * spending checks still inside execute. No scheduled job gets that override.
 */
export async function withProviderFacts<T>(identity: RequestIdentity, provider: AiProvider,
  execute: () => Promise<T>, recoveryTest = false): Promise<T> {
  const scope = providerScope(identity, provider);
  const outcome = await transaction(async client => {
    const lock = await client.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired", [JSON.stringify(scope)]);
    if (!lock.rows[0]?.acquired) {
      throw Object.assign(new Error(`AI_UNAVAILABLE: ${provider} already has a request in progress. Retry shortly.`),
        { provider, retryable: true });
    }
    const row = (await client.query<ProviderFacts>(`select * from ai_provider_facts
      where account_scope=$1 and provider=$2 and credential_hash=$3`, scope)).rows[0];
    if (row?.refusal_reason && !recoveryTest) {
      return { error: new ProviderRefusalError(provider, row.refusal_reason, row.refusal_status) };
    }
    try {
      const value = await execute();
      await client.query(`insert into ai_provider_facts(account_scope,provider,credential_hash,last_success_at)
        values($1,$2,$3,clock_timestamp()) on conflict(account_scope,provider,credential_hash) do update
        set last_success_at=excluded.last_success_at, refusal_reason=null, refusal_status=null`, scope);
      return { value };
    } catch (error) {
      const e = error as { provider?: string; retryable?: boolean; reason?: string; status?: number | null };
      // Local budget/configuration/persistence failures are not provider facts.
      if (e?.provider === provider && typeof e.retryable === "boolean" && e.reason) {
        await client.query(`insert into ai_provider_facts(account_scope,provider,credential_hash,
          last_failure_at,failure_reason,failure_status,refusal_reason,refusal_status)
          values($1,$2,$3,clock_timestamp(),$4,$5,$6,$7)
          on conflict(account_scope,provider,credential_hash) do update set
          last_failure_at=excluded.last_failure_at,failure_reason=excluded.failure_reason,
          failure_status=excluded.failure_status,
          refusal_reason=coalesce(excluded.refusal_reason,ai_provider_facts.refusal_reason),
          refusal_status=coalesce(excluded.refusal_status,ai_provider_facts.refusal_status)`,
        [...scope, e.reason, e.status ?? null, e.retryable ? null : e.reason, e.retryable ? null : e.status ?? null]);
      }
      return { error };
    }
  });
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
