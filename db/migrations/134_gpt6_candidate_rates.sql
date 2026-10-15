-- Additive standard-context candidate pricing; this does not select a model,
-- grant spending, release holds, replay receipts, or change existing rows.
-- Candidate transport is text-only, reasoning none, standard service tier,
-- explicit caching without breakpoints, input <=272K, output <=128K tokens.
-- Long-context, PDF and paid quality qualification are separate release gates.
insert into api_usage_rates(provider,service,rates,max_request_cost,evidence)
values
  ('OpenAI','gpt-6-luna',
   '{"input_tokens":"0.10","output_tokens":"0.50","cached_input_tokens":"0.01","cache_write_input_tokens":"0.125"}',
   3,'https://developers.openai.com/api/docs/models/gpt-6-luna (2026-10-14); standard-context candidate, rollout not approved'),
  ('OpenAI','gpt-6-sol',
   '{"input_tokens":"2","output_tokens":"10","cached_input_tokens":"0.20","cache_write_input_tokens":"2.50"}',
   3,'https://developers.openai.com/api/docs/models/gpt-6-sol (2026-10-14); standard-context candidate, rollout not approved')
on conflict(provider,service) do nothing;
