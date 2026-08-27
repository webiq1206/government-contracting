-- A change to what this platform says on the company's behalf is published,
-- not merely saved.
--
-- Saving a template made it live immediately. These are the emails the
-- platform sends to other people's businesses under the company's name, and
-- there was no step between a half-finished edit and the next outreach run
-- picking it up. The audit asks for approval on this page, and this is the
-- shape of it: a save writes a draft, and publishing is a separate act.
--
-- Everything already on file is published, because that is what it has been
-- doing. No existing template changes behaviour on this migration.

alter table templates
  add column if not exists status text not null default 'published',
  add column if not exists drafted_at timestamptz,
  add column if not exists drafted_by text,
  add column if not exists published_at timestamptz,
  add column if not exists published_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'templates_status_ck') then
    alter table templates add constraint templates_status_ck
      check (status in ('draft', 'published'));
  end if;
end $$;

/*
 * A draft is never the active row. The send path reads is_active, so this is
 * the line that keeps an unpublished edit out of somebody's inbox, and it is
 * enforced here rather than trusted to every writer.
 */
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'templates_draft_not_active_ck') then
    alter table templates add constraint templates_draft_not_active_ck
      check (status = 'published' or is_active = false);
  end if;
end $$;

-- One unpublished draft per template per org. A second one would leave the
-- editor unable to say which edit is waiting.
create unique index if not exists templates_one_draft_uidx
  on templates (org_id, slug) where status = 'draft';

update templates
   set published_at = coalesce(published_at, created_at)
 where is_active = true and published_at is null;
