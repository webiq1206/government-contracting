-- Future request evidence only. Historical reasons cannot be reconstructed.
alter table api_usage_events add column if not exists provider_diagnostics jsonb;
alter table api_usage_events add column if not exists configuration_reference jsonb;
comment on column api_usage_events.provider_diagnostics is
  'Allowlisted provider status/code/type/request ID/retry delay only; never raw bodies, prompts, messages or credentials';
comment on column api_usage_events.configuration_reference is
  'Nonsecret application configuration store/owner/setting reference; not a verified provider billing account';
