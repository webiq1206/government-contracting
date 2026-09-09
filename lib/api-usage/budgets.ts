import { DEFAULT_ACCOUNT_BUDGET } from "./defaults";
import { z } from "zod";
import { queryOne, transaction } from "../db";
import { validateCost } from "./money";

const dollars = z.string().refine((value) => {
  try { validateCost(value); return true; } catch { return false; }
}, "Enter a valid dollar amount.").nullable();
export const budgetSchema = z.object({
  dailyLimit: dollars,
  monthlyLimit: dollars,
  dailyRequests: z.number().int().min(0).max(1000000).nullable(),
  paused: z.boolean(),
  allowComplex: z.boolean(),
}).strict();

export async function saveBudget(orgId: string, actor: string, input: unknown) {
  const b = budgetSchema.parse(input);
  await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('api-usage-admission'))");
    await client.query(`insert into api_account_budgets
      (org_id,daily_limit,monthly_limit,daily_requests,paused,allow_complex)
      values($1,$2,$3,$4,$5,$6) on conflict(org_id) do update set
      daily_limit=excluded.daily_limit,monthly_limit=excluded.monthly_limit,
      daily_requests=excluded.daily_requests,paused=excluded.paused,
      allow_complex=excluded.allow_complex,updated_at=now()`,
      [orgId,b.dailyLimit,b.monthlyLimit,b.dailyRequests,b.paused,b.allowComplex]);
    await client.query("insert into api_usage_audit(org_id,actor,action,details) values($1,$2,'account_budget',$3)",
      [orgId,actor,JSON.stringify(b)]);
  });
}

/** Spending includes pending reservations. Platform usage uses customer-facing amounts. */
export async function readBudget(orgId: string) {
  const result = await queryOne(`select b.org_id as budget_org_id,b.daily_limit::text,b.monthly_limit::text,b.daily_requests,
    coalesce(b.paused,false) as paused,coalesce(b.allow_complex,true) as allow_complex,
    u.day_spend::text,u.month_spend::text,u.day_requests,u.unknown_costs,u.held_requests
    from (select $1::uuid as org_id) o left join api_account_budgets b using(org_id)
    cross join lateral (select
      coalesce(sum(coalesce(provider_cost,budget_cost,reserved_cost) * case when credential_source='platform' and billing_accepted then 1.25 else 1 end)
        filter(where started_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0) as day_spend,
      coalesce(sum(coalesce(provider_cost,budget_cost,reserved_cost) * case when credential_source='platform' and billing_accepted then 1.25 else 1 end),0) as month_spend,
      count(*) filter(where not (credential_source='unknown' and provider_cost=0 and billing_status='not_billable') and started_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')::int as day_requests,
      count(*) filter(where provider_cost is null and budget_cost is null and reserved_cost>0)::int as held_requests,
      count(*) filter(where provider_cost is null and budget_cost is null and reserved_cost=0)::int as unknown_costs
      from api_usage_events where org_id=$1 and started_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') u`, [orgId]);
  if (!result) throw new Error("Account budget could not be loaded.");
  if (!result.budget_org_id) Object.assign(result,DEFAULT_ACCOUNT_BUDGET);
  delete result.budget_org_id;
  return result;
}
