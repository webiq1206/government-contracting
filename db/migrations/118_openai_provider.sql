-- OpenAI as a second metered AI provider.
--
-- Published OpenAI standard rates checked 2026-09-14 at
-- https://developers.openai.com/api/docs/pricing. Dollars per million units.
-- The client reports input_tokens NET of cached tokens and cached_input_tokens
-- separately, so the three buckets add up without double counting; reasoning
-- tokens are already inside output_tokens and carry no rate of their own.
-- Ceilings are conservative per-request reservations, sized like the
-- Anthropic ones (Haiku 2, Sonnet 10). Never overwrite custom provider prices.
insert into api_usage_rates(provider,service,rates,max_request_cost,evidence) values
('OpenAI','gpt-5.6-luna','{"input_tokens":"0.20","output_tokens":"1.20","cached_input_tokens":"0.02"}',1,'https://developers.openai.com/api/docs/pricing (2026-09-14)'),
('OpenAI','gpt-5.6-terra','{"input_tokens":"2","output_tokens":"12","cached_input_tokens":"0.20"}',10,'https://developers.openai.com/api/docs/pricing (2026-09-14)'),
('OpenAI','gpt-5.6-sol','{"input_tokens":"4","output_tokens":"20","cached_input_tokens":"0.40"}',20,'https://developers.openai.com/api/docs/pricing (2026-09-14)'),
('OpenAI','gpt-5-mini','{"input_tokens":"0.25","output_tokens":"2","cached_input_tokens":"0.025"}',2,'https://developers.openai.com/api/docs/pricing (2026-09-14)'),
('OpenAI','gpt-5-nano','{"input_tokens":"0.05","output_tokens":"0.40","cached_input_tokens":"0.005"}',1,'https://developers.openai.com/api/docs/pricing (2026-09-14)'),
('OpenAI','gpt-5.4-mini','{"input_tokens":"0.75","output_tokens":"4.50","cached_input_tokens":"0.075"}',3,'https://developers.openai.com/api/docs/pricing (2026-09-14)'),
('OpenAI','gpt-4.1-mini','{"input_tokens":"0.40","output_tokens":"1.60","cached_input_tokens":"0.10"}',2,'https://developers.openai.com/api/docs/pricing (2026-09-14)')
on conflict(provider,service) do nothing;

-- Generic token estimate: every unit that has a rate, summed. Requires the
-- two buckets every text model reports so a partial usage object is never
-- priced as if it were free. Anthropic keeps api_message_estimate, whose
-- four fixed buckets are that provider's own shape.
create function api_token_estimate(units jsonb, rates jsonb) returns numeric
language sql immutable as $$
  select case when units ? 'input_tokens' and units ? 'output_tokens'
    and jsonb_typeof(units->'input_tokens')='number' and jsonb_typeof(units->'output_tokens')='number'
    and rates ?& array['input_tokens','output_tokens']
    then (select coalesce(sum((u.value)::numeric * (rates->>u.key)::numeric / 1000000),0)
      from jsonb_each_text(units) u where rates ? u.key and jsonb_typeof(units->u.key)='number')
    else null end
$$;
