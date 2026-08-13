-- Gmail connections become per-tenant.
--
-- integration_tokens was keyed by provider alone, so the entire platform
-- shared ONE Gmail connection: whichever account authorized last. Migration
-- 028 added an org_id column but nothing populated or keyed on it. This makes
-- the key (provider, org_id) so every customer connects their own inbox.

-- Existing rows belong to the founding tenant. Backfill before re-keying,
-- otherwise the new primary key would reject them on a null org_id.
update integration_tokens
   set org_id = '00000000-0000-4000-8000-000000000001'::uuid
 where org_id is null;

-- A row that still has no org after the backfill has no owner and cannot be
-- attributed to a tenant. Dropping it is safe: the affected tenant simply
-- reconnects, and keeping it would let one customer send from another's inbox.
delete from integration_tokens where org_id is null;

alter table integration_tokens
  alter column org_id set not null;

alter table integration_tokens
  drop constraint if exists integration_tokens_pkey;

alter table integration_tokens
  add constraint integration_tokens_pkey primary key (provider, org_id);

-- The address that authorized, shown in the UI so an operator can confirm they
-- connected the right mailbox, and used as the From identity for that tenant.
alter table integration_tokens
  add column if not exists email text;

-- Connection health. A refresh token can be revoked by the user at any time
-- from their Google account, and the failure surfaces only on the next API
-- call, so the outcome of that call is recorded here rather than inferred.
alter table integration_tokens
  add column if not exists status text not null default 'connected';
alter table integration_tokens
  add column if not exists last_error text;
alter table integration_tokens
  add column if not exists last_synced_at timestamptz;
-- Gmail history cursor, so reply sync is incremental instead of re-reading the
-- inbox window on every pass.
alter table integration_tokens
  add column if not exists history_id text;

create index if not exists integration_tokens_org_idx
  on integration_tokens (org_id, provider);
