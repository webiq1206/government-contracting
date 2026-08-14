-- Metering the platform keys a trial borrows.
--
-- Trials may use our Anthropic and Google Maps keys so a prospect can see the
-- product work on day one instead of waiting on credentials. Both are billed
-- per use, and the existing trial meters do not bound them: they cap AI bid
-- briefs at ten, but SCORING calls Claude once per ingested opportunity and is
-- counted by nothing. A trial pulling a hundred notices a day spends a
-- multiple of what the brief limit implies.
--
-- So borrowed keys are metered separately from product limits. This table
-- counts calls actually made on a platform credential, per organization and
-- per key, which is the number that turns into an invoice.
--
-- Deliberately not on integration_settings or platform_key_grants: a grant is
-- permission and this is consumption. Revoking a grant should not erase the
-- record of what was spent under it.

create table if not exists platform_key_usage (
  org_id     uuid not null references organizations(id) on delete cascade,
  env_key    text not null,
  -- Calls made on OUR credential. Never incremented when the organization is
  -- spending on its own key, which is the behaviour we want to encourage.
  calls      integer not null default 0,
  first_used timestamptz not null default now(),
  last_used  timestamptz not null default now(),
  primary key (org_id, env_key)
);

create index if not exists platform_key_usage_key_idx
  on platform_key_usage (env_key);
