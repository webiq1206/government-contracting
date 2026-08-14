-- Lending a platform key to a specific organization, deliberately.
--
-- The rule is that customers bring their own credentials: they are billed for
-- what they use, and a contractor without an approved SAM account cannot bid
-- on federal work anyway. Migration 050 enforced that by scoping every key to
-- its organization, with the platform's environment reachable only by the
-- founding org.
--
-- This adds the one exception the rule needs: an explicit, per-key, per-
-- organization grant. A prospect being walked through a demo, a customer
-- mid-migration who has requested a SAM key and is waiting on the government,
-- an account being supported through a problem. Each of those is a decision
-- someone makes on purpose, for one organization and one credential, and can
-- reverse.
--
-- What it is NOT is a fallback. Nothing here is implicit: absent a row in this
-- table, an organization without its own key gets nothing, which is the
-- behaviour that stops our Anthropic and Maps spend from quietly becoming
-- everyone's.

create table if not exists platform_key_grants (
  org_id     uuid not null references organizations(id) on delete cascade,
  -- The env key being lent, e.g. ANTHROPIC_API_KEY. Matches ALLOWED_ENV_KEYS.
  env_key    text not null,
  -- Who authorized it. Grants spend real money, so they are attributable.
  granted_by uuid references users(id),
  granted_at timestamptz not null default now(),
  -- Why, in the granter's words. Read months later when deciding to revoke.
  note       text,
  /**
   * Optional automatic expiry.
   *
   * A grant given "just for the demo" that nobody remembers to revoke is how
   * a temporary courtesy becomes a permanent bill. When set, resolution
   * ignores the grant past this moment without anything having to run.
   */
  expires_at timestamptz,
  primary key (org_id, env_key)
);

create index if not exists platform_key_grants_key_idx
  on platform_key_grants (env_key);
