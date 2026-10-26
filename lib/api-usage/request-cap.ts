/**
 * Refuse a paid call before taking the admission lock.
 *
 * beginUsage holds pg_advisory_xact_lock('api-usage-admission') and then
 * counts. Once a daily cap is already spent, every refusal still serializes
 * on that lock while holding a pool connection. Under Today traffic that
 * queue pins the database until the web process stops answering. This asks
 * the same count first, with no lock. A spent cap is remembered in this
 * process so the next refusal does not take another connection. A connection
 * the pool cannot hand out is remembered briefly and refused the same way.
 * Any other precheck failure returns null so the locked check still enforces
 * the cap. It never raises a default.
 */
import { query, queryOne } from "../db";
import { DEFAULT_ACCOUNT_BUDGET, DEFAULT_PLATFORM_REQUESTS } from "./defaults";
import { accountDailyRequestBlock, admissionBusyMessage, platformRequestCapMessage } from "../domain/spending-notice";

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
const BLOCK_TTL_MS = 30_000;
const BUSY_TTL_MS = 5_000;
const remembered = new Map<string, { until: number; message: string }>();

/** Drop a cached refusal. A budget save must take effect without waiting out the memo. */
export function clearRequestCapMemo(orgId?: string): void {
  if (!orgId) {
    remembered.clear();
    return;
  }
  for (const key of remembered.keys()) {
    if (key === `account:${orgId}` || key.startsWith(`${orgId}:`)) remembered.delete(key);
  }
}

function readMemo(key: string): string | null {
  const hit = remembered.get(key);
  if (!hit) return null;
  if (hit.until <= Date.now()) {
    remembered.delete(key);
    return null;
  }
  return hit.message;
}

function remember(key: string, message: string, ttl: number): void {
  remembered.set(key, { until: Date.now() + ttl, message });
}

function isAccountDailyBlock(message: string): boolean {
  return message.startsWith("API_BUDGET: You reached today's request limit of ");
}

/** A connection the pool could not hand out. Retrying through the admission lock would make the stall worse. */
function isPoolStarved(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "53300" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ECONNRESET") return true;
  return /timeout exceeded when trying to connect|remaining connection slots|sorry, too many clients/i.test(error.message);
}

export async function requestCapBlockMessage(input: CapInput): Promise<string | null> {
  const pooled = readMemo("pool");
  if (pooled) return pooled;
  const account = readMemo(`account:${input.orgId}`);
  if (account) return account;
  const key = `${input.orgId}:${input.source}:${input.provider}:${input.feature}`;
  const feature = readMemo(key);
  if (feature) return feature;
  const existing = inflight.get(key);
  if (existing) return existing;
  const run = computeCap(input).then((message) => {
    if (!message) return null;
    if (message.includes("usage ledger is busy")) {
      remember("pool", message, BUSY_TTL_MS);
      return message;
    }
    if (isAccountDailyBlock(message)) {
      remember(`account:${input.orgId}`, message, BLOCK_TTL_MS);
      return message;
    }
    remember(key, message, BLOCK_TTL_MS);
    return message;
  }).finally(() => {
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
    if (isPoolStarved(error)) return admissionBusyMessage();
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
