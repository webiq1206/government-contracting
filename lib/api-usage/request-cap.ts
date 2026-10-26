/**
 * Refuse a paid call before taking the admission lock.
 *
 * beginUsage holds pg_advisory_xact_lock('api-usage-admission') and then
 * counts. Once a daily cap is already spent, every refusal still serializes
 * on that lock while holding a pool connection. Under Today traffic that
 * queue pins the database until the web process stops answering. This asks
 * the same count first, with no lock. A failure here returns null so the
 * locked check still enforces the cap. It never raises a default.
 */
import { query, queryOne } from "../db";
import { DEFAULT_ACCOUNT_BUDGET, DEFAULT_PLATFORM_REQUESTS } from "./defaults";
import { accountDailyRequestBlock, platformRequestCapMessage } from "../domain/spending-notice";

export const ACCOUNT_DAY_REQUEST_COUNT_SQL = `select count(*)::int as calls from api_usage_events
  where org_id=$1 and not (credential_source='unknown' and provider_cost=0 and billing_status='not_billable')
  and started_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`;

export const PLATFORM_DAY_REQUEST_COUNT_SQL = `select count(*)::int as calls from api_usage_events
  where started_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
  and credential_source <> 'tenant' and not (credential_source='unknown' and provider_cost=0 and billing_status='not_billable')
  and ($1::uuid is null or org_id=$1)
  and ($2='*' or provider=$2) and ($3='*' or feature=$3)`;

type CapInput = {
  orgId: string;
  source: string;
  provider: string;
  feature: string;
};

type LimitRow = {
  org_id: string | null;
  provider: string;
  feature: string;
  daily_requests: number | null;
};

const inflight = new Map<string, Promise<string | null>>();

export async function requestCapBlockMessage(input: CapInput): Promise<string | null> {
  const key = `${input.orgId}:${input.source}:${input.provider}:${input.feature}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const run = computeCap(input).finally(() => {
    if (inflight.get(key) === run) inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}

async function computeCap(input: CapInput): Promise<string | null> {
  try {
    const account = await accountDailyCapMessage(input.orgId);
    if (account) return account;
    if (input.source === "tenant") return null;
    return await platformCapMessage(input.orgId, input.provider, input.feature);
  } catch (error) {
    console.error("[api-usage] request cap precheck failed", error);
    return null;
  }
}

/** Account daily request cap, or null when this org is still under it (or has none). */
export async function accountDailyCapMessage(orgId: string): Promise<string | null> {
  const row = await queryOne<{ daily_requests: number | null }>(
    "select daily_requests from api_account_budgets where org_id=$1",
    [orgId],
  );
  const limit = row ? row.daily_requests : DEFAULT_ACCOUNT_BUDGET.daily_requests;
  if (limit == null) return null;
  const count = await queryOne<{ calls: number }>(ACCOUNT_DAY_REQUEST_COUNT_SQL, [orgId]);
  const calls = Number(count?.calls ?? 0);
  if (calls >= Number(limit)) return accountDailyRequestBlock(Number(limit));
  return null;
}

async function platformCapMessage(
  orgId: string,
  provider: string,
  feature: string,
): Promise<string | null> {
  const limits = await query<LimitRow>(
    `select org_id, provider, feature, daily_requests from api_usage_limits
      where (org_id is null or org_id=$1) and provider in ('*',$2) and feature in ('*',$3)
        and daily_requests is not null`,
    [orgId, provider, feature],
  );
  const rows = [...limits];
  if (!rows.some((limit) => limit.org_id == null && limit.provider === "*" && limit.feature === "*")) {
    rows.push({
      org_id: null,
      provider: "*",
      feature: "*",
      daily_requests: DEFAULT_PLATFORM_REQUESTS,
    });
  }
  for (const limit of rows) {
    if (limit.daily_requests == null) continue;
    const count = await queryOne<{ calls: number }>(PLATFORM_DAY_REQUEST_COUNT_SQL, [
      limit.org_id,
      limit.provider,
      limit.feature,
    ]);
    if (Number(count?.calls ?? 0) >= Number(limit.daily_requests)) return platformRequestCapMessage();
  }
  return null;
}

/** Platform daily cap for status, independent of one provider call. */
export async function platformDailyCapSnapshot(orgId: string): Promise<{
  calls: number;
  limit: number | null;
}> {
  const limits = await query<LimitRow>(
    `select org_id, provider, feature, daily_requests from api_usage_limits
      where (org_id is null or org_id=$1) and daily_requests is not null`,
    [orgId],
  );
  const rows = [...limits];
  if (!rows.some((limit) => limit.org_id == null && limit.provider === "*" && limit.feature === "*")) {
    rows.push({
      org_id: null,
      provider: "*",
      feature: "*",
      daily_requests: DEFAULT_PLATFORM_REQUESTS,
    });
  }
  let tightest: { calls: number; limit: number } | null = null;
  for (const limit of rows) {
    if (limit.daily_requests == null) continue;
    const count = await queryOne<{ calls: number }>(PLATFORM_DAY_REQUEST_COUNT_SQL, [
      limit.org_id,
      limit.provider,
      limit.feature,
    ]);
    const calls = Number(count?.calls ?? 0);
    const cap = Number(limit.daily_requests);
    if (!tightest || calls / Math.max(cap, 1) > tightest.calls / Math.max(tightest.limit, 1)) {
      tightest = { calls, limit: cap };
    }
    if (calls >= cap) return { calls, limit: cap };
  }
  return tightest ?? { calls: 0, limit: DEFAULT_PLATFORM_REQUESTS };
}
