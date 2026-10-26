import { DEFAULT_ACCOUNT_BUDGET, DEFAULT_PLATFORM_REQUESTS } from "./defaults";
import { accountDailyRequestBlock, admissionBusyMessage, platformRequestCapMessage } from "../domain/spending-notice";
import { ACCOUNT_DAY_REQUEST_COUNT_SQL, PLATFORM_DAY_REQUEST_COUNT_SQL, requestCapBlockMessage } from "./request-cap";
import { isBoundedGpt6, gpt6ReservationCovered } from "../ai/model-contracts";
import { createHash, randomUUID } from "node:crypto";
import { query, queryOne, transaction } from "../db";
import { apiUsageContext } from "./context";
import { platformApiValue } from "./credentials";
import { LEGACY_ORG_ID } from "../tenant-context";
import { decryptSecret } from "../integration-settings";
import { providerDiagnostics, configurationReference, type ProviderDiagnostics, type ConfigurationReference } from "./diagnostics";
import { reserveProspectiveUsage } from "../prospective-boundary";
import { USAGE_ABANDON_MINUTES } from "../domain/hold-registry";

export type RequestIdentity = {
  orgId: string;
  envKey: string;
  value: string;
  source: "platform" | "tenant" | "unknown";
  accepted: boolean;
  configurationReference?: ConfigurationReference;
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
  let platformStore: ConfigurationReference["credentialStore"] = "unknown";
  const platform = Boolean(value && value === (await platformApiValue(envKey, store => { platformStore = store; })));
  const own = Boolean(
    value && saved && decryptSecret(saved.value_enc) === value,
  );
  return {
    orgId: org,
    envKey,
    value,
    source: platform ? "platform" : own ? "tenant" : "unknown",
    configurationReference: configurationReference({
      credentialStore: platform ? platformStore : own ? "tenant_settings" : "unknown",
      settingsOrgId: platform ? LEGACY_ORG_ID : own ? org : null,
      credentialSetting: envKey,
    }),
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

/** PostgreSQL lock_not_available. lock_timeout fired before the lock was granted. */
function isLockNotAvailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "55P03";
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
  options: { complex?: boolean; dryRun?: boolean; requirePrice?: boolean } = {},
): Promise<string> {
  const ctx = apiUsageContext();
  const candidate = provider === "OpenAI" && isBoundedGpt6(service);
  const requirePrice = options.requirePrice || candidate;
  feature = ctx.feature ?? feature;
  const id = randomUUID();
  // Already-spent request caps refuse here, before the admission lock.
  // Dollar limits and the same caps are still enforced inside the transaction.
  const cap = await requestCapBlockMessage({
    orgId: identity.orgId,
    source: identity.source,
    provider,
    feature,
  });
  if (cap) throw new ApiUsageBlockedError(cap);
  await transaction(async (client) => {
    // Serialize admissions with limit edits. Pending/unpriced requests block limited scopes,
    // rather than inventing a safe dollar reservation for an unknown provider charge.
    // A waiter must not hold its pool connection for the statement timeout.
    // Three seconds is enough to join a quiet ledger and short enough that a
    // stampede releases the connection instead of wedging the process.
    await client.query("select set_config('lock_timeout', '3000', true)");
    try {
      await client.query(
        "select pg_advisory_xact_lock(hashtext('api-usage-admission'))",
      );
    } catch (error) {
      if (isLockNotAvailable(error)) throw new ApiUsageBlockedError(admissionBusyMessage());
      throw error;
    }
    await client.query("select set_config('lock_timeout', '0', true)");
    const price = await client.query(
      "select max_request_cost::text,rates from api_usage_rates where provider=$1 and service=$2",
      [provider, service],
    );
    const reservation = price.rows[0]?.max_request_cost ?? null;
    const rates = price.rows[0]?.rates;
    if (requirePrice && (reservation == null || !Number.isFinite(Number(reservation)) || Number(reservation) <= 0 ||
      !rates || !["input_tokens", "output_tokens"].every(key => Number.isFinite(Number(rates[key])) && Number(rates[key]) > 0) ||
      Object.values(rates).some(rate => !Number.isFinite(Number(rate)) || Number(rate) < 0))) {
      throw new ApiUsageBlockedError("API_BUDGET: AI failover or candidate models require a priced request reservation on the selected model. Request-count limits cannot replace its shared dollar budget.");
    }
    if (candidate && isBoundedGpt6(service) && !gpt6ReservationCovered(service, rates, reservation))
      throw new ApiUsageBlockedError("API_BUDGET: Candidate model pricing or its existing reservation does not cover the full reviewed input/output envelope. No limit was raised or evidence shortened.");
    const markup = identity.source === "platform" && identity.accepted ? "1.25" : "1";
    const budget = await client.query("select * from api_account_budgets where org_id=$1", [identity.orgId]);
    const account = budget.rows[0] ?? DEFAULT_ACCOUNT_BUDGET;
    if (requirePrice && (!account ||
      ![account.daily_limit, account.monthly_limit].some(cap => cap != null && Number.isFinite(Number(cap)) && Number(cap) > 0))) {
      throw new ApiUsageBlockedError("API_BUDGET: AI failover or candidate models require a finite shared dollar limit across providers.");
    }
    if (account) {
      const blocked = (reason: string) => new ApiUsageBlockedError(
        `API_BUDGET: ${reason} New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.`,
      );
      if (account.paused) throw blocked("You paused API use.");
      if (options.complex && !account.allow_complex)
        throw blocked("Complex AI work is paused in your cost controls.");
      if (account.daily_requests != null) {
        const count = await client.query(ACCOUNT_DAY_REQUEST_COUNT_SQL, [identity.orgId]);
        if (count.rows[0].calls >= account.daily_requests)
          throw new ApiUsageBlockedError(accountDailyRequestBlock(Number(account.daily_requests)));
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
          throw blocked(`${unknown} earlier request${unknown === 1 ? " is" : "s are"} still awaiting confirmation of ${unknown === 1 ? "its" : "their"} cost, so your ${label} allowance cannot admit more paid work while the evidence remains unresolved. Review API Usage; unverified costs remain held.`);
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
        const count = await client.query(PLATFORM_DAY_REQUEST_COUNT_SQL,
          [limit.org_id,limit.provider,limit.feature]);
        if (count.rows[0].calls >= limit.daily_requests)
          throw new ApiUsageBlockedError(platformRequestCapMessage());
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
            `API_BUDGET: ${unknown} platform request${unknown === 1 ? " is" : "s are"} still awaiting confirmation of ${unknown === 1 ? "its" : "their"} cost, so the platform's monthly limit cannot admit more paid work. Review the unresolved evidence in Admin, API Usage. Unverified costs remain held; use your own API account if available.`,
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
    if (options.dryRun) {
      await reserveProspectiveUsage(client, identity, provider, service, reservation, id, true);
      return;
    }
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
    await reserveProspectiveUsage(client, identity, provider, service, reservation, id);
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
  units?: Record<string, number | undefined>;
  actualCost?: string;
  evidence?: string;
  errorCode?: string;
  failed?: boolean;
  diagnostics?: ProviderDiagnostics;
  configurationReference?: ConfigurationReference;
};
export async function finishUsage(
  id: string,
  result: UsageResult,
): Promise<void> {
  const units = Object.fromEntries(
    Object.entries(result.units ?? {}).filter(
      ([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0,
    ),
  );
  if (result.actualCost != null)
    (await import("./money")).validateCost(result.actualCost);
  // Only explicit validation/authentication/allowance refusals release the
  // budget ceiling. Server errors (including bare 529), HTTP 408 and transport
  // failures can follow completed provider work and must retain uncertainty.
  // This changes future completion only; it does not adjudicate historical rows.
  const providerRejected = Boolean(result.failed) &&
    /^HTTP (400|401|402|403|404|413|422|429)$/.test(result.errorCode ?? "");
  await query(
    `update api_usage_events e set finished_at=now(), outcome=$2, provider_request_id=$3,
    usage=$4::jsonb,provider_cost=$5::numeric,evidence=$6,error_code=$7,
    provider_diagnostics=$10::jsonb,configuration_reference=$11::jsonb,
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
      result.diagnostics ? JSON.stringify(providerDiagnostics({ diagnostics: result.diagnostics })) : null,
      result.configurationReference ? JSON.stringify(configurationReference(result.configurationReference)) : null,
    ],
  );
  // Only observed completion, never the time-based abandoned-usage sweep,
  // can close the separate dispatch marker introduced by the preview gate.
  // An ambiguous error retains it even if this ledger labels the row failed.
  if (!result.failed || providerRejected) await query(
    "update prospective_dispatch_claims set finished_at=now() where id=$1 and kind='api' and finished_at is null",[id]);
}

/**
 * Close ledger rows whose request can no longer be running.
 *
 * A row stays `pending` when the process died between admission and
 * completion, or when the completion write itself failed. The default age
 * is the provider hard timeout plus its safety margin, so the call cannot
 * still be on the wire. The reservation is kept (the provider may have
 * completed and billed the work) but the row is now a finished failure
 * awaiting verified cost evidence, and it ages out of the daily and monthly
 * windows like every other charge. This does not replay the request.
 */
export async function settleAbandonedUsage(olderThanMinutes = USAGE_ABANDON_MINUTES): Promise<number> {
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
  options: { complex?: boolean; requirePrice?: boolean } = {},
): Promise<T> {
  const id = await beginUsage(identity, provider, service, feature, options);
  let value: T;
  try {
    value = await execute();
  } catch (error) {
    const diagnostics = providerDiagnostics(error, [identity.value]);
    const status = diagnostics.httpStatus;
    await finishUsage(id, {
      failed: true,
      errorCode: status
        ? `HTTP ${status}`
        : "Request failed; cost needs review",
      units: { requests: 1 },
      requestId: diagnostics.requestId ?? undefined,
      diagnostics,
      configurationReference: identity.configurationReference,
    }).catch(() =>
      console.error("[api-usage] pending request needs reconciliation", id),
    );
    throw error;
  }
  try {
    const result = describe(value);
    await finishUsage(id, {...result, configurationReference: identity.configurationReference,
      ...(result.diagnostics ? {diagnostics:providerDiagnostics({diagnostics:result.diagnostics},[identity.value])} : {})});
  } catch {
    console.error(
      "[api-usage] provider completed; pending ledger entry needs reconciliation",
      id,
    );
  }
  return value;
}
