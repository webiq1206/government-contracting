-- Evidence belongs to the effective account/credential, including keys without
-- an integration_settings row. Never expires a refusal or changes usage limits.
create table ai_provider_facts (
  account_scope text not null,
  provider text not null check (provider in ('Anthropic','OpenAI')),
  credential_hash text not null,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_reason text,
  failure_status integer,
  refusal_reason text,
  refusal_status integer,
  primary key (account_scope, provider, credential_hash)
);
alter table ai_provider_facts enable row level security;
revoke all on ai_provider_facts from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then
    revoke all on ai_provider_facts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    revoke all on ai_provider_facts from authenticated;
  end if;
end $$;
