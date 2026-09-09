import { DEFAULT_ACCOUNT_BUDGET, DEFAULT_PLATFORM_REQUESTS } from "./defaults";
import { createHash, randomUUID } from "node:crypto";
import { query, queryOne, transaction } from "../db";
import { apiUsageContext } from "./context";
import { platformApiValue } from "./credentials";
import { LEGACY_ORG_ID } from "../tenant-context";
import { decryptSecret } from "../integration-settings";

export type RequestIdentity = {
  orgId: string;
  envKey: string;
  value: string;
  source: "platform" | "tenant" | "unknown";
  accepted: boolean;
};
/** Classify the exact credential being sent, not whichever setting was last saved. */
export async function requestIdentity(
  envKey: string,
  value: string,
  orgId?: string,
): Promise<RequestIdentity> {
  const org = orgId ?? (await (await import("../tenant")).resolveTenantOrgId());
  const [saved, preference] = await Promise.all([
    queryOne<{ value_enc: string }>(
      "select value_enc from integration_settings where org_id=$1 and env_key=$2",
      [org, envKey],
    ),
    queryOne<{ source: string; accepted_at: string | null }>(
      "select source, accepted_at from api_usage_preferences where org_id=$1 and env_key=$2",
      [org, envKey],
    ),
  ]);
  // Matching the platform value always means the platform pays, even if someone pasted it as their own.
  const platform = Boolean(value && value === (await platformApiValue(envKey)));
  const own = Boolean(
    value && saved && decryptSecret(saved.value_enc) === value,
  );
  return {
    orgId: org,
    envKey,
    value,
    source: platform ? "platform" : own ? "tenant" : "unknown",
    accepted:
      platform &&
      org !== LEGACY_ORG_ID &&
      preference?.source === "platform" &&
      Boolean(preference.accepted_at),
  };
}
export class ApiUsageBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUsageBlockedError";
  }
}
export async function beginUsage(
  identity: RequestIdentity,
  provider: string,
  service: string,
  feature: string,
  options: { complex?: boolean; dryRun?: boolean } = {},
): Promise<string> {
  const ctx = apiUsageContext();
  feature = ctx.feature ?? feature;
  const id = randomUUID();
  await transaction(async (client) => {
    // Serialize admissions with limit edits. Pending/unpriced requests block limited scopes,
    // rather than inventing a safe dollar reservation for an unknown provider charge.
    await client.query(
      "select pg_advisory_xact_lock(hashtext('api-usage-admission'))",
    );
    const price = await client.query(
      "select max_request_cost::text,rates from api_usage_rates where provider=$1 and service=$2",
      [provider, service],
    );
    const reservation = price.rows[0]?.max_request_cost ?? null;
    const budget = await client.query("select * from api_account_budgets where org_id=$1", [identity.orgId]);
    const account = budget.rows[0] ?? DEFAULT_ACCOUNT_BUDGET;
    if (account) {
      const blocked = (reason: string) => new ApiUsageBlockedError(
        `API_BUDGET: ${reason} New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.`,
      );
      if (account.paused) throw blocked("You paused API use.");
      if (options.complex && !account.allow_complex)
        throw blocked("Complex AI work is paused in your cost controls.");
      if (account.daily_requests != null) {
        const count = await client.query(`select count(*)::int as calls from api_usage_events
          where org_id=$1 and not (credential_source='unknown' and provider_cost=0 and billing_status='not_billable') and started_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`, [identity.orgId]);
        if (count.rows[0].calls >= account.daily_requests)
          throw blocked("You reached today's request limit. It resets at midnight UTC.");
      }
      for (const period of ["day", "month"] as const) {
        const cap = period === "day" ? account.daily_limit : account.monthly_limit;
        if (cap == null) continue;
        if (reservation == null) throw blocked("This service needs a price ceiling before a dollar limit can protect your spending. Ask the platform administrator to set one, or use a request-count limit.");
        const totals = await client.query(`select
          coalesce(sum(coalesce(provider_cost,budget_cost,reserved_cost) * case when credential_source='platform' and billing_accepted then 1.25 else 1 end),0)
            + $3::numeric * $4::numeric > $5::numeric as exceeds,
          count(*) filter(where provider_cost is null and budget_cost is null and reserved_cost=0)::int as unknown
          from api_usage_events where org_id=$1
            and started_at >= date_trunc($2,now() at time zone 'UTC') at time zone 'UTC'`,
          [identity.orgId,period,reservation,identity.source === "platform" && identity.accepted ? "1.25" : "1",cap]);
        if (totals.rows[0].exceeds || totals.rows[0].unknown > 0)
          throw blocked(`Your ${period === "day" ? "daily" : "monthly"} allowance cannot cover another request, including costs awaiting confirmation.`);
      }
    }
    const limits = await client.query(
      `select * from api_usage_limits where
      (org_id is null or org_id=$1) and provider in ('*',$2) and feature in ('*',$3)`,
      [identity.orgId, provider, feature],
    );
    if (!limits.rows.some(l => l.org_id == null && l.provider === "*" && l.feature === "*")) {
      limits.rows.push({org_id:null,provider:"*",feature:"*",daily_requests:DEFAULT_PLATFORM_REQUESTS});
    }
    for (const limit of limits.rows) {
      if (limit.daily_requests != null && identity.source !== "tenant") {
        const count = await client.query(`select count(*)::int as calls from api_usage_events
          where started_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
          and credential_source <> 'tenant' and not (credential_source='unknown' and provider_cost=0 and billing_status='not_billable') and ($1::uuid is null or org_id=$1)
          and ($2='*' or provider=$2) and ($3='*' or feature=$3)`,
          [limit.org_id,limit.provider,limit.feature]);
        if (count.rows[0].calls >= limit.daily_requests)
          throw new ApiUsageBlockedError("API_BUDGET: The platform's daily request allowance has been reached. New paid work is on hold. Ask the platform administrator to review API Usage limits, or wait until midnight UTC.");
      }
      if (limit.paused)
        throw new ApiUsageBlockedError(
          "API use is paused. Ask your administrator to resume it in API Usage.",
        );
      if (limit.require_tenant_key && identity.source !== "tenant")
        throw new ApiUsageBlockedError(
          "Connect your own API account in Settings, API Usage.",
        );
      if (limit.monthly_limit != null && identity.source !== "tenant") {
        if (reservation == null)
          throw new ApiUsageBlockedError(
            "This API has no configured maximum request cost. Your hard dollar limit blocks platform requests until an administrator sets a price ceiling or you use your own API.",
          );
        const totals = await client.query(
          `select coalesce(sum(coalesce(provider_cost,budget_cost,reserved_cost)),0)+$4::numeric > $5::numeric as exceeds,
          count(*) filter(where provider_cost is null and budget_cost is null and reserved_cost=0) as unknown from api_usage_events
          where started_at >= date_trunc('month',now()) and credential_source <> 'tenant'
          and ($1::uuid is null or org_id=$1) and ($2='*' or provider=$2) and ($3='*' or feature=$3)`,
          [
            limit.org_id,
            limit.provider,
            limit.feature,
            reservation,
            String(limit.monthly_limit),
          ],
        );
        if (totals.rows[0].exceeds || Number(totals.rows[0].unknown) > 0)
          throw new ApiUsageBlockedError(
            "Your API limit cannot cover another request. Review pending costs, increase the limit, or use your own API account.",
          );
      }
    }
    if (identity.source === "unknown")
      throw new ApiUsageBlockedError(
        "The API account could not be identified. Reconnect the service before retrying.",
      );
    if (options.dryRun) return;
    await client.query(
      `insert into api_usage_events
      (id,org_id,user_id,provider,service,feature,workflow,related_id,credential_source,credential_fingerprint,billing_accepted,billing_status,reserved_cost,price_snapshot)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        identity.orgId,
        ctx.userId ?? null,
        provider,
        service,
        feature,
        ctx.workflow ?? null,
        ctx.relatedId ?? null,
        identity.source,
        createHash("sha256").update(identity.value).digest("hex"),
        identity.accepted,
        identity.source === "tenant" ? "not_billable" : "review",
        reservation ?? "0",
        price.rows[0]?.rates ? JSON.stringify(price.rows[0].rates) : null,
      ],
    );
    if (identity.source === "platform")
      await client.query(
        `insert into platform_key_usage(org_id,env_key,calls) values($1,$2,1)
      on conflict(org_id,env_key) do update set calls=platform_key_usage.calls+1,last_used=now()`,
        [identity.orgId, identity.envKey],
      );
  });
  return id;
}
export type UsageResult = {
  requestId?: string;
  units?: Record<string, number>;
  actualCost?: string;
  evidence?: string;
  errorCode?: string;
  failed?: boolean;
};
export async function finishUsage(
  id: string,
  result: UsageResult,
): Promise<void> {
  const units = Object.fromEntries(
    Object.entries(result.units ?? {}).filter(
      ([, v]) => Number.isFinite(v) && v >= 0,
    ),
  );
  if (result.actualCost != null)
    (await import("./money")).validateCost(result.actualCost);
  await query(
    `update api_usage_events e set finished_at=now(), outcome=$2, provider_request_id=$3,
    usage=$4::jsonb,provider_cost=$5::numeric,evidence=$6,error_code=$7,
    budget_cost=case when e.provider='Anthropic' and not $8::boolean then api_message_estimate($4::jsonb,e.price_snapshot)*1.1 else null end,
    estimated_cost=case when e.provider='Anthropic' then api_message_estimate($4::jsonb,e.price_snapshot) else (select sum((u.value::text)::numeric * (r.rates->>u.key)::numeric / 1000000)
      from api_usage_rates r,jsonb_each($4::jsonb) u where r.provider=e.provider and r.service=e.service) end,
    billing_status=case when credential_source='tenant' then 'not_billable'
      when $5::numeric is not null and billing_accepted then 'unbilled' else 'review' end
    where id=$1 and outcome='pending'`,
    [
      id,
      result.failed ? "failed" : "success",
      result.requestId ?? null,
      JSON.stringify(units),
      result.actualCost ?? null,
      result.evidence ?? null,
      result.errorCode ?? null,
      result.failed ?? false,
    ],
  );
}
/** Persist intent before I/O. Never retry provider work when only persistence failed. */
export async function metered<T>(
  identity: RequestIdentity,
  provider: string,
  service: string,
  feature: string,
  execute: () => Promise<T>,
  describe: (value: T) => UsageResult = () => ({ units: { requests: 1 } }),
  options: { complex?: boolean } = {},
): Promise<T> {
  const id = await beginUsage(identity, provider, service, feature, options);
  let value: T;
  try {
    value = await execute();
  } catch (error) {
    const status = (error as { status?: number })?.status;
    await finishUsage(id, {
      failed: true,
      errorCode: status
        ? `HTTP ${status}`
        : "Request failed; cost needs review",
      units: { requests: 1 },
    }).catch(() =>
      console.error("[api-usage] pending request needs reconciliation", id),
    );
    throw error;
  }
  try {
    await finishUsage(id, describe(value));
  } catch {
    console.error(
      "[api-usage] provider completed; pending ledger entry needs reconciliation",
      id,
    );
  }
  return value;
}
