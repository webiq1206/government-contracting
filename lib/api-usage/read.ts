import { query } from "../db";
export const PROVIDERS = [
  "Anthropic",
  "Google Maps",
  "Hunter",
  "Ahrefs",
  "Twilio",
  "SAM.gov",
  "USAspending",
  "BLS",
] as const;
class UsageFilterError extends Error {
  name = "UsageFilterError";
}
export async function readUsage(params: URLSearchParams, tenantId?: string) {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (expression: string, value: unknown) => {
    values.push(value);
    where.push(expression.replace("?", `$${values.length}`));
  };
  if (tenantId) add("e.org_id=?", tenantId);
  else if (params.get("tenant")) add("e.org_id=?::uuid", params.get("tenant"));
  const now = new Date();
  const period = params.get("period") ?? "month";
  let from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (period === "today") from = new Date(now.toISOString().slice(0, 10));
  if (period === "week") from = new Date(now.getTime() - 7 * 86400000);
  let start = params.get("from") ? new Date(params.get("from")!) : from;
  let end = params.get("to")
    ? new Date(new Date(params.get("to")!).getTime() + 86400000)
    : new Date(now.getTime() + 1);
  if (period === "billing") {
    const org = tenantId ?? params.get("tenant");
    if (!org)
      throw new UsageFilterError("Choose a tenant to view its billing period.");
    const periods = await query<{ starts_at: string; ends_at: string }>(
      "select starts_at::text,ends_at::text from api_usage_billing_periods where org_id=$1 and starts_at<=now() and ends_at>now() order by starts_at desc limit 1",
      [org],
    );
    if (!periods[0])
      throw new UsageFilterError(
        "No current billing period is synchronized. Ask an administrator to sync billing.",
      );
    start = new Date(periods[0].starts_at);
    end = new Date(periods[0].ends_at);
  }
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  )
    throw new UsageFilterError("Choose a valid date range.");
  add("e.started_at>=?::timestamptz", start.toISOString());
  add("e.started_at<?::timestamptz", end.toISOString());
  for (const [param, column] of Object.entries({
    provider: "provider",
    service: "service",
    source: "credential_source",
    feature: "feature",
    outcome: "outcome",
    status: "billing_status",
  })) {
    const value = params.get(param);
    if (value) add(`e.${column}=?`, value);
  }
  const filter = where.join(" and ");
  const page = Math.floor(
    Math.max(1, Math.min(100000, Number(params.get("page")) || 1)),
  );
  const sort =
    (
      {
        newest: "e.started_at desc",
        cost: "e.provider_cost desc nulls last",
        charge: "e.tenant_charge desc nulls last",
        margin: "(e.tenant_charge-e.provider_cost) desc nulls last",
        tenant: "o.name asc",
        provider: "e.provider asc",
        usage: "coalesce((e.usage->>'requests')::numeric,0) desc",
      } as Record<string, string>
    )[params.get("sort") ?? "newest"] ?? "e.started_at desc";
  const amount = "coalesce(e.provider_cost,e.estimated_cost) * case when e.credential_source='platform' and e.billing_accepted then 1.25 else 1 end";
  const estimate = `case when count(*)=0 then 0 when count(coalesce(e.provider_cost,e.estimated_cost))=0 then null else sum(${amount}) end`;
  const fields = `e.id,e.org_id,o.name as tenant,e.provider,e.service,e.feature,e.workflow,e.related_id,e.started_at::text,
    e.outcome,e.credential_source,e.usage,case when e.credential_source='platform' and e.provider_cost is null then null else e.tenant_charge end::text as tenant_charge,(${amount})::text as usage_amount, (e.provider_cost is null and e.estimated_cost is not null) as is_estimate,e.billing_status,${tenantId ? "case when e.outcome='failed' then 'This request did not complete. Review Automation Health for next steps.' else null end as error_code" : "e.error_code"},e.invoice_reference`;
  const costs = tenantId
    ? ""
    : ",e.provider_cost::text,e.estimated_cost::text,e.evidence,e.provider_request_id,e.billing_accepted,e.user_id";
  const [
    rows,
    summary,
    groups,
    daily,
    options,
    limits,
    issues,
    alerts,
    leaders,
  ] = await Promise.all([
    query(
      `select ${fields}${costs} from api_usage_events e left join organizations o on o.id=e.org_id where ${filter}
      order by ${tenantId && ["cost", "margin"].includes(params.get("sort") ?? "") ? "e.started_at desc" : sort},e.id limit 20 offset ${Math.floor((page - 1) * 20)}`,
      values,
    ),
    query(
      `select count(*)::int as calls,count(*) filter(where credential_source='platform')::int as platform_calls,
      count(*) filter(where credential_source='tenant')::int as tenant_calls,
      count(*) filter(where provider_cost is null and credential_source='platform')::int as awaiting_cost,
      count(*) filter(where outcome='failed')::int as failed,
      case when count(*) filter(where credential_source='platform' and provider_cost is null)>0 then null else sum(tenant_charge) end::text as tenant_charge, (${estimate})::text as usage_amount
      ${tenantId ? "" : ",sum(provider_cost) filter(where credential_source='platform')::text as provider_cost,sum(estimated_cost) filter(where credential_source='platform')::text as estimated_cost,sum(tenant_charge-provider_cost) filter(where credential_source='platform' and billing_accepted)::text as margin"}
      from api_usage_events e where ${filter}`,
      values,
    ),
    query(
      `select e.org_id,o.name as tenant,e.provider,count(*)::int as calls,case when count(*) filter(where e.credential_source='platform' and e.provider_cost is null)>0 then null else sum(e.tenant_charge) end::text as tenant_charge, (${estimate})::text as usage_amount
      ${tenantId ? "" : ",sum(e.provider_cost) filter(where e.credential_source='platform')::text as provider_cost"}
      from api_usage_events e left join organizations o on o.id=e.org_id where ${filter}
      group by e.org_id,o.name,e.provider order by sum(e.tenant_charge) desc nulls last limit 100`,
      values,
    ),
    query(
      `select (e.started_at at time zone 'UTC')::date::text as day,count(*)::int as calls,case when count(*) filter(where credential_source='platform' and provider_cost is null)>0 then null else sum(tenant_charge) end::text as tenant_charge, (${estimate})::text as usage_amount
      ${tenantId ? "" : ",sum(provider_cost) filter(where credential_source='platform')::text as provider_cost"}
      from api_usage_events e where ${filter} group by 1 order by 1`,
      values,
    ),
    query(
      `select distinct provider,service,feature from api_usage_events e ${tenantId ? "where org_id=$1" : ""} order by provider,service limit 500`,
      tenantId ? [tenantId] : [],
    ),
    tenantId
      ? Promise.resolve([])
      : query(
          `select l.*,o.name as tenant from api_usage_limits l left join organizations o on o.id=l.org_id order by l.updated_at desc`,
        ),
    tenantId
      ? Promise.resolve([])
      : query(`select 'duplicate' as kind,provider,provider_request_id as detail,count(*)::int as calls
      from api_usage_events where provider_request_id is not null group by provider,provider_request_id having count(*)>1
      union all select 'unattributed',provider,'Missing account',count(*)::int from api_usage_events where org_id is null group by provider
      union all select 'price_changed',provider,'Confirmed cost exceeded its configured maximum',count(*)::int from api_usage_events where reserved_cost>0 and provider_cost>reserved_cost group by provider
      union all select 'unfinished',provider,'Requests awaiting a result for over 15 minutes',count(*)::int from api_usage_events
      where outcome='pending' and started_at<now()-interval '15 minutes' group by provider
      union all select 'no_consent',provider,'Platform use without billing acceptance',count(*)::int from api_usage_events
      where credential_source='platform' and not billing_accepted and org_id <> '00000000-0000-4000-8000-000000000001' group by provider limit 100`),
    tenantId
      ? Promise.resolve([])
      : query(`with daily as (
      select org_id,provider,date_trunc('day',started_at) as day,count(*) as calls,
      sum(provider_cost) filter(where credential_source='platform') as cost from api_usage_events
      where started_at>=date_trunc('day',now())-interval '7 days' group by 1,2,3)
      select 'spike' as kind,o.name as tenant,d.provider,
        'Requests today are more than twice the daily average of the previous week.' as detail
      from daily d left join organizations o on o.id=d.org_id
      where d.day=date_trunc('day',now()) and d.calls>=10 and d.calls>2*coalesce((
        select sum(p.calls)/7.0 from daily p where p.org_id=d.org_id and p.provider=d.provider and p.day<d.day),0)
      union all select 'failures',o.name,e.provider,'At least five failed requests today. Review this workflow before retrying.'
      from api_usage_events e left join organizations o on o.id=e.org_id
      where e.started_at>=date_trunc('day',now()) and e.outcome='failed' group by o.name,e.provider having count(*)>=5
      union all select 'limit',o.name,l.provider,'Confirmed monthly cost is approaching or has reached the spending limit.'
      from api_usage_limits l left join organizations o on o.id=l.org_id where l.monthly_limit is not null
      and (select coalesce(sum(e.provider_cost),0) from api_usage_events e where e.started_at>=date_trunc('month',now())
      and e.credential_source='platform' and (l.org_id is null or e.org_id=l.org_id) and (l.provider='*' or l.provider=e.provider)
      and (l.feature='*' or l.feature=e.feature))>=l.monthly_limit*l.warning_percent/100 limit 100`),
    tenantId
      ? Promise.resolve([])
      : query(
          `with grouped as (
      select org_id,provider,count(*) as calls,sum(provider_cost) filter(where credential_source='platform') as cost
      from api_usage_events e where ${filter} group by org_id,provider), tenant_totals as (
      select org_id,sum(calls) as calls,sum(cost) as cost from grouped group by org_id)
      (select 'Highest usage tenant' as label,o.name as name,t.calls::text as value from tenant_totals t
      left join organizations o on o.id=t.org_id order by t.calls desc limit 1)
      union all (select 'Highest cost tenant',o.name,t.cost::text from tenant_totals t left join organizations o on o.id=t.org_id
      where t.cost is not null order by t.cost desc limit 1)
      union all (select 'Highest cost API',provider,sum(cost)::text from grouped group by provider
      having sum(cost) is not null order by sum(cost) desc limit 1)`,
          values,
        ),
  ]);
  return {
    leaders,
    alerts,
    rows,
    summary: summary[0],
    groups,
    daily,
    options,
    limits,
    issues,
    page,
    from: start.toISOString(),
    to: end.toISOString(),
  };
}
