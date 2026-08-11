-- Hard-dedupe opportunities so the same solicitation cannot exist twice
-- within an organization.
--
-- 1) Align multi-tenant intent: drop legacy GLOBAL unique(source_id).
-- 2) Unique (org_id, source_id) for every external notice id.
-- 3) Unique (org_id, normalized solicitation_number) among OPEN rows so
--    amendments / reposts / cross-portal copies cannot open a second pipeline.

-- Normalize empty ids to NULL (UNIQUE allows multiple NULLs).
update opportunities
   set source_id = null
 where source_id is not null and btrim(source_id) = '';

update opportunities
   set solicitation_number = null
 where solicitation_number is not null and btrim(solicitation_number) = '';

-- Ensure org_id is set before composite uniques.
update opportunities
   set org_id = '00000000-0000-4000-8000-000000000001'::uuid
 where org_id is null;

-- ---------------------------------------------------------------------------
-- Collapse duplicate (org_id, source_id) rows: keep the oldest.
-- Child rows cascade-delete with the loser.
-- ---------------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by org_id, source_id
           order by created_at asc, id asc
         ) as rn
    from opportunities
   where source_id is not null
)
delete from opportunities o
 using ranked r
 where o.id = r.id
   and r.rn > 1;

-- ---------------------------------------------------------------------------
-- Collapse duplicate OPEN solicitation numbers per org: keep the oldest open.
-- ---------------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by org_id, lower(btrim(solicitation_number))
           order by created_at asc, id asc
         ) as rn
    from opportunities
   where status = 'open'
     and solicitation_number is not null
     and btrim(solicitation_number) <> ''
)
delete from opportunities o
 using ranked r
 where o.id = r.id
   and r.rn > 1;

-- Drop the legacy global unique on source_id (name from 000_init).
alter table opportunities drop constraint if exists opportunities_source_id_key;

-- Some environments may have created it as a unique index instead.
drop index if exists opportunities_source_id_key;

-- One external notice per organization.
create unique index if not exists opportunities_org_source_id_uniq
  on opportunities (org_id, source_id)
  where source_id is not null;

-- One open pipeline per solicitation number per organization.
create unique index if not exists opportunities_org_solnum_open_uniq
  on opportunities (org_id, (lower(btrim(solicitation_number))))
  where status = 'open'
    and solicitation_number is not null
    and btrim(solicitation_number) <> '';
