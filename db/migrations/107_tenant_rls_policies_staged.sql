-- Staged PostgreSQL row-level-security policies for tenant-owned records.
--
-- This migration closes the policy gap without pretending the application is
-- ready to change database roles. The web and worker currently connect as the
-- table owner, which bypasses ENABLE RLS. FORCE RLS here would immediately
-- break authentication, platform administration, worker fanout, job tenant
-- discovery, Stripe webhook idempotency, and tenant settings because those
-- paths do not yet execute inside one transaction-local tenant context.
--
-- The safe rollout is therefore:
--
--   1. Install these policies while the migration owner remains the runtime
--      owner. There is no behavior change for that owner.
--   2. Move each tenant request/job to tenantTransaction(), including every
--      statement in that unit of work.
--   3. Give web and tenant-job processes a separate NOSUPERUSER,
--      NOBYPASSRLS, non-owner role with only the privileges they need.
--   4. Keep the owner credential only in the release migration job. Platform
--      maintenance needs a separately authenticated, narrowly invoked path,
--      not a caller-controlled custom setting.
--
-- Do not replace this staging with a GUC-based bypass. Any database session
-- can assign a custom GUC, so brostco.org_id selects a tenant but can never be
-- treated as proof that a caller is a platform administrator.

do $migration$
declare
  tenant_table record;
  context_sql text :=
    $expression$nullif(pg_catalog.current_setting('brostco.org_id', true), '')::uuid$expression$;
  -- These tables cannot safely receive an ordinary tenant policy yet:
  --
  -- app_settings stores tenant ownership inside a key prefix while org_id is
  -- still null. It needs a data migration and org_id-based queries first.
  --
  -- stripe_events is claimed before a webhook can always resolve its tenant.
  -- It needs a platform webhook role or a constrained SECURITY DEFINER claim
  -- API before a non-owner runtime can use it.
  --
  -- templates treats the founding customer's rows as the platform defaults.
  -- That is an application-level sharing convention, not an RLS-safe ownership
  -- model. Move defaults to a platform-owned table or copy known-safe defaults
  -- into each new organization before permitting tenant reads.
  staged_blockers text[] := array[
    'account_invitations',
    'analytics_events',
    'app_settings',
    'password_reset_tokens',
    'sessions',
    'stripe_events',
    'templates',
    'user_email_aliases',
    'users',
    'worker_heartbeat'
  ];
begin
  for tenant_table in
    select c.relname as table_name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and (
         c.relname = any(staged_blockers)
         or exists (
           select 1
             from pg_catalog.pg_attribute a
            where a.attrelid = c.oid
              and a.attname = 'org_id'
              and not a.attisdropped
              and a.atttypid = 'uuid'::pg_catalog.regtype
         )
       )
     order by c.relname
  loop
    execute format(
      'alter table public.%I enable row level security',
      tenant_table.table_name
    );

    if tenant_table.table_name = any(staged_blockers) then
      -- An explicit restrictive false policy keeps this denied even if a
      -- later feature adds a permissive policy. Leave the current owner
      -- behavior unchanged until the blockers above move to explicit data
      -- models and trusted execution paths.
      execute format(
        'drop policy if exists brostco_staged_deny on public.%I',
        tenant_table.table_name
      );
      execute format(
        'create policy brostco_staged_deny on public.%I '
        'as restrictive for all using (false) with check (false)',
        tenant_table.table_name
      );
      continue;
    end if;

    -- A permissive policy makes the intended tenant rows reachable. The same
    -- expression is also installed as RESTRICTIVE so a later feature policy
    -- cannot widen access by being ORed with this one.
    execute format(
      'drop policy if exists brostco_tenant_access on public.%I',
      tenant_table.table_name
    );
    execute format(
      'drop policy if exists brostco_tenant_boundary on public.%I',
      tenant_table.table_name
    );
    execute format(
      'create policy brostco_tenant_access on public.%I '
      'as permissive for all using (org_id = %s) with check (org_id = %s)',
      tenant_table.table_name,
      context_sql,
      context_sql
    );
    execute format(
      'create policy brostco_tenant_boundary on public.%I '
      'as restrictive for all using (org_id = %s) with check (org_id = %s)',
      tenant_table.table_name,
      context_sql,
      context_sql
    );
  end loop;
end
$migration$;

-- Runtime startup compares this build's migration filenames and checksums with
-- the release ledger. Make that read possible for a separately granted role,
-- while restrictive command policies keep the ledger immutable to runtime
-- even if a write grant is added by mistake.
alter table public._migrations enable row level security;
drop policy if exists brostco_schema_read_access on public._migrations;
drop policy if exists brostco_schema_read_boundary on public._migrations;
drop policy if exists brostco_schema_insert_deny on public._migrations;
drop policy if exists brostco_schema_update_deny on public._migrations;
drop policy if exists brostco_schema_delete_deny on public._migrations;
create policy brostco_schema_read_access on public._migrations
  as permissive for select using (true);
create policy brostco_schema_read_boundary on public._migrations
  as restrictive for select using (true);
create policy brostco_schema_insert_deny on public._migrations
  as restrictive for insert with check (false);
create policy brostco_schema_update_deny on public._migrations
  as restrictive for update using (false) with check (false);
create policy brostco_schema_delete_deny on public._migrations
  as restrictive for delete using (false);

-- organizations owns itself rather than carrying a second org_id column.
alter table public.organizations enable row level security;
drop policy if exists brostco_tenant_access on public.organizations;
drop policy if exists brostco_tenant_boundary on public.organizations;
create policy brostco_tenant_access on public.organizations
  as permissive for all
  using (
    id = nullif(pg_catalog.current_setting('brostco.org_id', true), '')::uuid
  )
  with check (
    id = nullif(pg_catalog.current_setting('brostco.org_id', true), '')::uuid
  );
create policy brostco_tenant_boundary on public.organizations
  as restrictive for all
  using (
    id = nullif(pg_catalog.current_setting('brostco.org_id', true), '')::uuid
  )
  with check (
    id = nullif(pg_catalog.current_setting('brostco.org_id', true), '')::uuid
  );

-- Intentionally no FORCE ROW LEVEL SECURITY. The table owner is the explicit
-- release/maintenance bypass. The deployment gate separately rejects that
-- owner, its memberships, SUPERUSER, and BYPASSRLS for web/tenant-job runtime.
