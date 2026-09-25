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

/**
 * A request whose cost is still unknown AND which should have had one.
 *
 * Only a service with a configured price ceiling can leave a row like this:
 * it was admitted before the ceiling existed, or its ledger completion never
 * ran. A service with no price model is governed by request counts instead
 * (see beginUsage), so its rows are not "awaiting confirmation" and must not
 * hold every other service's dollar allowance hostage. Before this scoping,
 * one unpriced Ahrefs call blocked the account's Anthropic work for the rest
 * of the month.
 */
export const UNCONFIRMED_PRICED_SQL = `e.provider_cost is null and e.budget_cost is null and e.reserved_cost = 0
  and exists (select 1 from api_usage_rates r
               where r.provider = e.provider and r.service = e.service and r.max_request_cost is not null)`;

/** Dollars for a budget sentence: two places, no thousands separators. */
function usd(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
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
    const markup = identity.source === "platform" && identity.accepted ? "1.25" : "1";
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
          throw blocked(`You reached today's request limit of ${account.daily_requests}. It resets at midnight UTC.`);
      }
      for (const period of ["day", "month"] as const) {
        const cap = period === "day" ? account.daily_limit : account.monthly_limit;
        if (cap == null) continue;
        if (reservation == null) {
          /*
           * No price ceiling means no honest dollar reservation. The account's
           * request-count limit (checked above) is what protects an unpriced
           * service, which is exactly what the refusal below asks for. Only
           * when there is no request limit either is there nothing to fall
           * back on, and then paid work must stop.
           */
          if (account.daily_requests != null) break;
          throw blocked("This service needs a price ceiling before a dollar limit can protect your spending. Ask the platform administrator to set one, or use a request-count limit.");
        }
        const totals = await client.query(`select
          coalesce(sum(coalesce(e.provider_cost,e.budget_cost,e.reserved_cost) * case when e.credential_source='platform' and e.billing_accepted then 1.25 else 1 end),0)::text as spent,
          count(*) filter(where ${UNCONFIRMED_PRICED_SQL})::int as unknown
          from api_usage_events e where e.org_id=$1
            and e.started_at >= date_trunc($2,now() at time zone 'UTC') at time zone 'UTC'`,
          [identity.orgId, period]);
        const label = period === "day" ? "daily" : "monthly";
        const unknown = Number(totals.rows[0].unknown);
        if (unknown > 0)
          throw blocked(`${unknown} earlier request${unknown === 1 ? " is" : "s are"} still awaiting confirmation of ${unknown === 1 ? "its" : "their"} cost, so your ${label} allowance cannot admit more paid work until ${unknown === 1 ? "it is" : "they are"} confirmed or written off in API Usage.`);
        const spent = Number(totals.rows[0].spent);
        const ceiling = Number(reservation) * Number(markup);
        if (spent + ceiling > Number(cap))
          throw blocked(`Your ${label} allowance cannot cover another request: $${usd(spent)} is spent or reserved against a $${usd(cap)} limit, and this request could cost up to $${usd(ceiling)}.`);
      }
    }
    const limits = await client.query(
      `select * from api_usage_limits where
      (org_id is null or org_id=$1) and provider in ('*',$2) and feature in ('*',$3)`,
      [identity.orgId, provider, feature],
    );
    /*
     * An administrator who set an explicit request-count safeguard has chosen
     * the control that works for unpriced services. The built-in fallback row
     * pushed below is a safety net, not that choice, so it is counted before
     * the row is added.
     */
    const platformRequestCounted =
      identity.source !== "tenant" && limits.rows.some((l) => l.daily_requests != null);
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
        if (reservation == null) {
          // Same rule as the account tier: an explicit request-count
          // safeguard governs an unpriced service; a dollar cap cannot.
          if (platformRequestCounted) continue;
          throw new ApiUsageBlockedError(
            "This API has no configured maximum request cost. Your hard dollar limit blocks platform requests until an administrator sets a price ceiling or you use your own API.",
          );
        }
        const totals = await client.query(
          `select coalesce(sum(coalesce(e.provider_cost,e.budget_cost,e.reserved_cost)),0)::text as spent,
          count(*) filter(where ${UNCONFIRMED_PRICED_SQL})::int as unknown from api_usage_events e
          where e.started_at >= date_trunc('month',now()) and e.credential_source <> 'tenant'
          and ($1::uuid is null or e.org_id=$1) and ($2='*' or e.provider=$2) and ($3='*' or e.feature=$3)`,
          [limit.org_id, limit.provider, limit.feature],
        );
        const unknown = Number(totals.rows[0].unknown);
        if (unknown > 0)
          throw new ApiUsageBlockedError(
            `API_BUDGET: ${unknown} platform request${unknown === 1 ? " is" : "s are"} still awaiting confirmation of ${unknown === 1 ? "its" : "their"} cost, so the platform's monthly limit cannot admit more paid work. Confirm or write ${unknown === 1 ? "it" : "them"} off in Admin, API Usage, increase the limit, or use your own API account.`,
          );
        const spent = Number(totals.rows[0].spent);
        if (spent + Number(reservation) > Number(limit.monthly_limit))
          throw new ApiUsageBlockedError(
            `API_BUDGET: Your API limit cannot cover another request: $${usd(spent)} is spent or reserved this month against a $${usd(String(limit.monthly_limit))} limit. Review pending costs, increase the limit, or use your own API account.`,
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
  /*
   * A request the provider refused with an HTTP error status was never
   * processed and is not billed: Anthropic and OpenAI charge only for a
   * completed response, and a 401, 429 or 529 returns none. Holding such a
   * request at its full price ceiling for the rest of the day was how two
   * overloaded-provider refusals of a $10-ceiling model consumed a $25 daily
   * allowance and stopped every analysis until midnight. A failure with no
   * status (a timeout, a dropped connection) keeps its reservation, because
   * the provider may well have finished and billed the work.
   */
  const providerRejected = Boolean(result.failed) && /^HTTP [45]\d\d$/.test(result.errorCode ?? "");
  await query(
    `update api_usage_events e set finished_at=now(), outcome=$2, provider_request_id=$3,
    usage=$4::jsonb,provider_cost=$5::numeric,evidence=$6,error_code=$7,
    budget_cost=case when $9::boolean then 0
      when $8::boolean then null
      when e.provider='Anthropic' then api_message_estimate($4::jsonb,e.price_snapshot)*1.1
      when e.provider='OpenAI' then api_token_estimate($4::jsonb,e.price_snapshot)*1.1
      else (select sum((u.value::text)::numeric * (r.rates->>u.key)::numeric / 1000000) * 1.1
      from api_usage_rates r,jsonb_each($4::jsonb) u where r.provider=e.provider and r.service=e.service) end,
    estimated_cost=case when e.provider='Anthropic' then api_message_estimate($4::jsonb,e.price_snapshot)
      when e.provider='OpenAI' then api_token_estimate($4::jsonb,e.price_snapshot)
      else (select sum((u.value::text)::numeric * (r.rates->>u.key)::numeric / 1000000)
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
      providerRejected,
    ],
  );
}

/**
 * Close ledger rows whose request can no longer be running.
 *
 * A row stays `pending` when the process died between admission and
 * completion, or when the completion write itself failed. Nothing else ever
 * touches it, so it sat in the "in flight" column forever and kept its full
 * price ceiling held against every later admission. Two hours is far past
 * any single provider call's timeout. The reservation is kept (the provider
 * may have completed and billed the work) but the row is now a finished
 * failure that an administrator can reconcile, and it ages out of the daily
 * and monthly windows like every other charge.
 */
export async function settleAbandonedUsage(olderThanMinutes = 120): Promise<number> {
  const rows = await query<{ id: string }>(
    `update api_usage_events
        set outcome='failed', finished_at=now(),
            error_code='Abandoned: the process stopped before the provider answered; cost needs review'
      where outcome='pending'
        and started_at < now() - ($1::int * interval '1 minute')
      returning id`,
    [olderThanMinutes],
  );
  return rows.length;
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
