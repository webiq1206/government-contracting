/**
 * Live spending block for one organization.
 *
 * Callers pass the session org id. This never resolves a tenant on its own,
 * so a missing session cannot throw MissingTenantContextError while a banner
 * is being drawn. A database failure throws; only the shell may turn that
 * into "do not assume paid AI is running."
 */
import { queryOne } from "../db";
import { requestCache } from "../request-cache";
import { readBudget } from "./budgets";
import { platformDailyCapSnapshot } from "./request-cap";
import {
  blockMessageForFacts,
  noticeForFacts,
  type SpendingFacts,
  type SpendingNotice,
} from "../domain/spending-notice";

export interface SpendingBlock {
  notice: SpendingNotice;
  message: string;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cap(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function usesPlatformKey(orgId: string): Promise<boolean> {
  const row = await queryOne<{ uses: boolean }>(
    `select (
        exists (
          select 1 from api_usage_preferences
           where org_id = $1
             and source = 'platform'
             and accepted_at is not null
             and env_key in ('ANTHROPIC_API_KEY', 'OPENAI_API_KEY')
        )
        or exists (
          select 1 from api_usage_events
           where org_id = $1
             and credential_source = 'platform'
             and started_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
        )
      ) as uses`,
    [orgId],
  );
  return row?.uses === true;
}

export const readSpendingBlock = requestCache(async (orgId: string): Promise<SpendingBlock | null> => {
  const budget = (await readBudget(orgId)) as {
    daily_limit?: string | null;
    monthly_limit?: string | null;
    daily_requests?: number | null;
    paused?: boolean;
    day_spend?: string | null;
    month_spend?: string | null;
    day_requests?: number | null;
    unknown_costs?: number | null;
  };
  const platformUser = await usesPlatformKey(orgId);
  const platform = platformUser
    ? await platformDailyCapSnapshot(orgId)
    : { calls: 0, limit: null as number | null };
  const facts: SpendingFacts = {
    dayRequests: num(budget.day_requests),
    dailyRequestLimit: cap(budget.daily_requests),
    paused: budget.paused === true,
    daySpend: num(budget.day_spend),
    dailyDollarLimit: cap(budget.daily_limit),
    monthSpend: num(budget.month_spend),
    monthlyDollarLimit: cap(budget.monthly_limit),
    unknownCosts: num(budget.unknown_costs),
    platformDayRequests: platform.calls,
    platformDailyLimit: platform.limit,
    usesPlatformKey: platformUser,
  };
  const notice = noticeForFacts(facts);
  const message = blockMessageForFacts(facts);
  if (!notice || !message) return null;
  return { notice, message };
});
