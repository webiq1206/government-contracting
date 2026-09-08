-- Database-level tenant relationship guards.
--
-- Application queries still have to filter by org_id because the deployed
-- server currently connects as the table owner and therefore bypasses RLS.
-- These guards cover the other half of the boundary: a write cannot attach a
-- tenant-owned child to a parent in another organization, and an owned record
-- cannot silently be reassigned to another organization.
--
-- This migration preserves existing data, but it is not a zero-downtime
-- migration. The repository runner wraps the whole file in one transaction;
-- the backfill, ordinary index builds, and trigger/constraint DDL therefore
-- hold locks until commit. Apply it with application, worker, webhook, and
-- scheduled-job writes paused, or split those phases into a purpose-built
-- online migration before deployment.
--
--   * Existing rows are not deleted or assigned to a guessed organization.
--   * NOT VALID checks protect every new row without scanning old rows.
--   * Relationship triggers validate new or changed references only.
--   * A separate read-only verifier reports legacy rows that need cleanup.
--
-- After the verifier reports no legacy violations, validate each
-- *_org_id_present_ck constraint. A validated check can later support a
-- low-risk SET NOT NULL migration without an additional table scan.

-- opportunity_subs was the only central tenant join without its own owner.
-- Backfill only when both parents prove the same organization. A pre-existing
-- mixed-tenant pairing is left null so it is visible to the deployment gate
-- instead of being assigned to either customer.
alter table public.opportunity_subs
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;

update public.opportunity_subs os
   set org_id = o.org_id
  from public.opportunities o,
       public.subcontractors s
 where os.opportunity_id = o.id
   and os.subcontractor_id = s.id
   and os.org_id is null
   and o.org_id is not null
   and o.org_id = s.org_id;

create index if not exists opportunity_subs_org_idx
  on public.opportunity_subs (org_id, opportunity_id);

-- Parent and child both carry org_id. The trigger derives a missing child
-- owner from the referenced row, then rejects any disagreement. The native
-- foreign key remains responsible for reporting a missing parent.
create or replace function public.enforce_tenant_reference()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  parent_schema text := tg_argv[0];
  parent_table  text := tg_argv[1];
  child_column  text := tg_argv[2];
  reference_id  uuid;
  parent_org    uuid;
  parent_found  boolean := false;
begin
  reference_id := nullif(to_jsonb(new) ->> child_column, '')::uuid;
  if reference_id is null then
    return new;
  end if;

  execute format(
    'select org_id, true from %I.%I where id = $1',
    parent_schema,
    parent_table
  )
  into parent_org, parent_found
  using reference_id;

  -- Let the ordinary foreign key produce its standard missing-parent error.
  if not coalesce(parent_found, false) then
    return new;
  end if;

  if parent_org is null then
    raise exception using
      errcode = '23514',
      message = 'The referenced record has no organization owner.',
      detail = format(
        '%I.%I column %I cannot reference an unowned tenant record.',
        tg_table_schema,
        tg_table_name,
        child_column
      ),
      constraint = 'tenant_reference_guard';
  end if;

  if new.org_id is null then
    new.org_id := parent_org;
  elsif new.org_id <> parent_org then
    raise exception using
      errcode = '23514',
      message = 'Tenant ownership does not match the referenced record.',
      detail = format(
        '%I.%I column %I must reference a row in the same organization.',
        tg_table_schema,
        tg_table_name,
        child_column
      ),
      constraint = 'tenant_reference_guard';
  end if;

  return new;
end
$$;

-- Changing a record's org_id after creation can move it into another
-- customer's query results and can invalidate every child beneath it. The
-- only supported exception is the database's own ON DELETE SET NULL action
-- after the owning organization has actually been deleted. A custom session
-- setting is deliberately not a bypass: ordinary database sessions may set
-- arbitrary custom GUCs, so treating one as authorization would let runtime
-- SQL disable the boundary.
create or replace function public.prevent_tenant_reassignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owning_organization_was_deleted boolean := false;
begin
  if old.org_id is not null and new.org_id is null then
    -- Referential actions run after the referenced organization row has been
    -- deleted. A direct UPDATE while that organization still exists cannot
    -- satisfy this test. SECURITY DEFINER is required so eventual tenant RLS
    -- cannot hide the parent row and turn an ordinary update into a false
    -- deletion signal.
    select not exists (
      select 1 from public.organizations where id = old.org_id
    ) into owning_organization_was_deleted;
  end if;

  if old.org_id is not null
     and new.org_id is distinct from old.org_id
     and not owning_organization_was_deleted then
    raise exception using
      errcode = '23514',
      message = 'Tenant ownership is immutable.',
      detail = format(
        '%I.%I cannot be reassigned to a different organization.',
        tg_table_schema,
        tg_table_name
      ),
      hint = 'Reviewed repairs require the migration owner to control and re-enable this trigger inside the repair transaction, then rerun the tenant isolation verifier before traffic resumes.',
      constraint = 'tenant_ownership_immutable';
  end if;
  return new;
end
$$;

-- Install guards from the actual foreign-key catalog so every current
-- relationship is covered, including documents.superseded_by and the newer
-- contract, compliance, incident, reply, and pricing tables. Only simple UUID
-- references to an id column are selected. Both tables must carry org_id.
create or replace function public.install_tenant_reference_guards()
returns integer
language plpgsql
set search_path = pg_catalog
as $$
declare
  relation record;
  owned_table record;
  trigger_name text;
  installed integer := 0;
begin
  for owned_table in
    select n.nspname as schema_name,
           c.relname as table_name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and exists (
         select 1
           from pg_catalog.pg_attribute a
          where a.attrelid = c.oid
            and a.attname = 'org_id'
            and not a.attisdropped
       )
  loop
    trigger_name := 'tenant_owner_immutable_' || substr(
      md5(owned_table.schema_name || '.' || owned_table.table_name),
      1,
      16
    );
    execute format(
      'drop trigger if exists %I on %I.%I',
      trigger_name,
      owned_table.schema_name,
      owned_table.table_name
    );
    execute format(
      'create trigger %I before update of org_id on %I.%I '
      'for each row execute function public.prevent_tenant_reassignment()',
      trigger_name,
      owned_table.schema_name,
      owned_table.table_name
    );
  end loop;

  for relation in
    select child_ns.nspname as child_schema,
           child.relname as child_table,
           child_col.attname as child_column,
           parent_ns.nspname as parent_schema,
           parent.relname as parent_table
      from pg_catalog.pg_constraint fk
      join pg_catalog.pg_class child on child.oid = fk.conrelid
      join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
      join pg_catalog.pg_class parent on parent.oid = fk.confrelid
      join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
      join pg_catalog.pg_attribute child_col
        on child_col.attrelid = fk.conrelid
       and child_col.attnum = fk.conkey[1]
      join pg_catalog.pg_attribute parent_col
        on parent_col.attrelid = fk.confrelid
       and parent_col.attnum = fk.confkey[1]
     where fk.contype = 'f'
       and child_ns.nspname = 'public'
       and parent_ns.nspname = 'public'
       and array_length(fk.conkey, 1) = 1
       and array_length(fk.confkey, 1) = 1
       and child_col.atttypid = 'uuid'::regtype
       and parent_col.atttypid = 'uuid'::regtype
       and parent_col.attname = 'id'
       and exists (
         select 1 from pg_catalog.pg_attribute a
          where a.attrelid = child.oid
            and a.attname = 'org_id'
            and not a.attisdropped
       )
       and exists (
         select 1 from pg_catalog.pg_attribute a
          where a.attrelid = parent.oid
            and a.attname = 'org_id'
            and not a.attisdropped
       )
  loop
    trigger_name := 'tenant_ref_guard_' || substr(
      md5(
        relation.child_schema || '.' || relation.child_table || '.' ||
        relation.child_column || '->' || relation.parent_schema || '.' ||
        relation.parent_table
      ),
      1,
      20
    );
    execute format(
      'drop trigger if exists %I on %I.%I',
      trigger_name,
      relation.child_schema,
      relation.child_table
    );
    execute format(
      'create trigger %I before insert or update of org_id, %I on %I.%I '
      'for each row execute function public.enforce_tenant_reference(%L, %L, %L)',
      trigger_name,
      relation.child_column,
      relation.child_schema,
      relation.child_table,
      relation.parent_schema,
      relation.parent_table,
      relation.child_column
    );
    installed := installed + 1;
  end loop;

  return installed;
end
$$;

-- Recovery rows originally stored these ids without foreign keys. Add the
-- missing relationships without scanning history. New writes now prove that
-- the failed run and opportunity exist and, through the generic guard, belong
-- to the same organization as the incident replay.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.incident_requeues'::regclass
       and conname = 'incident_requeues_source_run_fk'
  ) then
    alter table public.incident_requeues
      add constraint incident_requeues_source_run_fk
      foreign key (source_run_id) references public.job_runs(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.incident_requeues'::regclass
       and conname = 'incident_requeues_opportunity_fk'
  ) then
    alter table public.incident_requeues
      add constraint incident_requeues_opportunity_fk
      foreign key (opportunity_id) references public.opportunities(id)
      on delete set null not valid;
  end if;
end
$$;

select public.install_tenant_reference_guards();

-- These are tenant-owned records for which a null owner is never meaningful.
-- NOT VALID preserves any legacy row for explicit review while enforcing the
-- rule on all future inserts and updates.
do $$
declare
  table_name text;
  constraint_name text;
  tenant_tables text[] := array[
    'company_profile',
    'scoring_weights',
    'opportunities',
    'subcontractors',
    'opportunity_subs',
    'quotes',
    'pricing_comps',
    'bids',
    'contracts',
    'communications',
    'documents',
    'templates',
    'compliance_items',
    'call_cards',
    'content_library',
    'custom_kpis',
    'file_blobs',
    'subcontractor_reply_events',
    'subcontractor_documents',
    'subcontractor_payments',
    'reply_drafts',
    'backlink_competitors',
    'backlink_prospects',
    'backlink_outreach',
    'backlinks',
    'authority_snapshots'
  ];
begin
  foreach table_name in array tenant_tables
  loop
    if not exists (
      select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = table_name
         and c.relkind in ('r', 'p')
    ) then
      continue;
    end if;

    constraint_name := table_name || '_org_id_present_ck';
    if not exists (
      select 1
        from pg_catalog.pg_constraint c
       where c.conrelid = format('public.%I', table_name)::regclass
         and c.conname = constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (org_id is not null) not valid',
        table_name,
        constraint_name
      );
    end if;
  end loop;
end
$$;

-- Backlink identities were globally unique even after org_id was added. That
-- let a second tenant's upsert target the first tenant's row. Build the new
-- indexes before dropping the old constraints so there is never an unguarded
-- interval. Existing global uniqueness guarantees that these builds cannot
-- encounter a tenant-local duplicate unless the production schema drifted.
do $$
begin
  if exists (
    select 1
      from public.backlink_competitors
     where org_id is not null
     group by org_id, domain
    having count(*) > 1
  ) then
    raise exception 'Backlink competitor duplicates must be resolved before tenant-scoped uniqueness can be installed.';
  end if;
  if exists (
    select 1
      from public.backlink_prospects
     where org_id is not null
     group by org_id, domain, opportunity_type
    having count(*) > 1
  ) then
    raise exception 'Backlink prospect duplicates must be resolved before tenant-scoped uniqueness can be installed.';
  end if;
  if exists (
    select 1
      from public.backlinks
     where org_id is not null
       and source_url is not null
       and target_url is not null
     group by org_id, source_url, target_url
    having count(*) > 1
  ) then
    raise exception 'Backlink duplicates must be resolved before tenant-scoped uniqueness can be installed.';
  end if;
end
$$;

create unique index if not exists backlink_competitors_org_domain_uniq
  on public.backlink_competitors (org_id, domain);
create unique index if not exists backlink_prospects_org_domain_type_uniq
  on public.backlink_prospects (org_id, domain, opportunity_type);
create unique index if not exists backlinks_org_source_target_uniq
  on public.backlinks (org_id, source_url, target_url);

alter table public.backlink_competitors
  drop constraint if exists backlink_competitors_domain_key;
alter table public.backlink_prospects
  drop constraint if exists backlink_prospects_domain_opportunity_type_key;
alter table public.backlinks
  drop constraint if exists backlinks_source_url_target_url_key;

-- Trigger/install functions are migration infrastructure, not browser RPCs.
revoke all on function public.enforce_tenant_reference() from public;
revoke all on function public.prevent_tenant_reassignment() from public;
revoke all on function public.install_tenant_reference_guards() from public;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.enforce_tenant_reference() from anon';
    execute 'revoke all on function public.prevent_tenant_reassignment() from anon';
    execute 'revoke all on function public.install_tenant_reference_guards() from anon';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.enforce_tenant_reference() from authenticated';
    execute 'revoke all on function public.prevent_tenant_reassignment() from authenticated';
    execute 'revoke all on function public.install_tenant_reference_guards() from authenticated';
  end if;
end
$$;
