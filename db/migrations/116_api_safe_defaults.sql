-- Keep estimates separate from confirmed invoices. Snapshot rates at admission.
alter table api_usage_events add column price_snapshot jsonb;
alter table api_usage_events add column budget_cost numeric(24,12) check(budget_cost >= 0);
-- Published direct Anthropic standard rates checked 2026-09-09. Maximum ceilings
-- include context/output and cache writes. Never overwrite custom provider prices.
insert into api_usage_rates(provider,service,rates,max_request_cost,evidence) values
('Anthropic','claude-haiku-4-5','{"input_tokens":"1","output_tokens":"5","cache_read_input_tokens":"0.1","cache_creation_input_tokens":"1.25"}',2,'https://platform.claude.com/docs/en/about-claude/pricing (2026-09-09)'),
('Anthropic','claude-haiku-4-5-20251001','{"input_tokens":"1","output_tokens":"5","cache_read_input_tokens":"0.1","cache_creation_input_tokens":"1.25"}',2,'https://platform.claude.com/docs/en/about-claude/pricing (2026-09-09)'),
('Anthropic','claude-sonnet-5','{"input_tokens":"2","output_tokens":"10","cache_read_input_tokens":"0.2","cache_creation_input_tokens":"2.5"}',10,'https://platform.claude.com/docs/en/about-claude/pricing (2026-09-09)'),
('Anthropic','claude-sonnet-4-6','{"input_tokens":"3","output_tokens":"15","cache_read_input_tokens":"0.3","cache_creation_input_tokens":"3.75"}',10,'https://platform.claude.com/docs/en/about-claude/pricing (2026-09-09)')
on conflict(provider,service) do nothing;

-- Snapshot prior standard message usage only where token counts actually exist.
-- An unfinished/failed or unpriced call remains unknown and is never made free.
update api_usage_events e set price_snapshot=r.rates
from api_usage_rates r where e.provider=r.provider and e.service=r.service
  and e.provider='Anthropic' and e.price_snapshot is null;
create function api_message_estimate(units jsonb, rates jsonb) returns numeric
language sql immutable as $$
  select case when units ? 'input_tokens' and units ? 'output_tokens'
    and jsonb_typeof(units->'input_tokens')='number' and jsonb_typeof(units->'output_tokens')='number'
    and rates ?& array['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens']
    then (select sum((units->>k)::numeric * (rates->>k)::numeric / 1000000)
      from unnest(array['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens']) k)
    else null end
$$;
update api_usage_events set estimated_cost=coalesce(estimated_cost,api_message_estimate(usage,price_snapshot)),
  budget_cost=api_message_estimate(usage,price_snapshot)*1.1
where provider='Anthropic' and outcome='success' and provider_cost is null and budget_cost is null;

-- Hold a conservative ceiling for old calls whose outcome/cost is unresolved.
update api_usage_events e set reserved_cost=r.max_request_cost
from api_usage_rates r where e.provider='Anthropic' and e.provider=r.provider and e.service=r.service
 and e.provider_cost is null and e.budget_cost is null and e.reserved_cost=0;

-- Fill unset safeguards without changing any existing numeric cap or pause.
insert into api_account_budgets(org_id,daily_limit,monthly_limit,daily_requests)
select id,25,250,100 from organizations on conflict(org_id) do update set
 daily_limit=coalesce(api_account_budgets.daily_limit,25),
 monthly_limit=coalesce(api_account_budgets.monthly_limit,250),
 daily_requests=coalesce(api_account_budgets.daily_requests,100);
insert into api_usage_limits(org_id,provider,feature,monthly_limit,daily_requests)
values(null,'*','*',1000,1000)
on conflict(coalesce(org_id::text,''),provider,feature) do update set
 monthly_limit=coalesce(api_usage_limits.monthly_limit,1000),
 daily_requests=coalesce(api_usage_limits.daily_requests,1000);
