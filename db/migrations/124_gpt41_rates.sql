-- GPT-4.1 standard API rates, verified against official model documentation.
-- Preserve operator-configured rates and ceilings.
insert into api_usage_rates(provider,service,rates,max_request_cost,evidence)
values ('OpenAI','gpt-4.1',
  '{"input_tokens":"2","output_tokens":"8","cached_input_tokens":"0.50"}',
  3,'https://developers.openai.com/api/docs/models/gpt-4.1 (2026-09-26)')
on conflict(provider,service) do nothing;

-- Restore the shared estimator if an earlier database repair omitted it.
create or replace function api_token_estimate(units jsonb, rates jsonb) returns numeric
language sql immutable as $$
  select case when units ? 'input_tokens' and units ? 'output_tokens'
    and jsonb_typeof(units->'input_tokens')='number' and jsonb_typeof(units->'output_tokens')='number'
    and rates ?& array['input_tokens','output_tokens']
    then (select coalesce(sum((u.value)::numeric * (rates->>u.key)::numeric / 1000000),0)
      from jsonb_each_text(units) u where rates ? u.key and jsonb_typeof(units->u.key)='number')
    else null end
$$;
