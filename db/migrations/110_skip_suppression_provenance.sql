-- Link a standing call suppression to the exact skip action that created it.
--
-- Without provenance, undoing a call skip has two unsafe choices: leave its
-- no-contact rule active, or lift any matching rule even when that rule existed
-- before the skip. New rules name their source card, so undo can lift its own
-- decision and nothing else. Historical nulls stay null and are never guessed.

alter table public.outreach_suppressions
  add column if not exists source_call_card_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.outreach_suppressions'::regclass
       and conname = 'outreach_suppressions_source_call_card_fk'
  ) then
    alter table public.outreach_suppressions
      add constraint outreach_suppressions_source_call_card_fk
      foreign key (source_call_card_id) references public.call_cards(id)
      on delete set null not valid;
  end if;
end
$$;

create index if not exists outreach_suppressions_source_call_card_idx
  on public.outreach_suppressions (org_id, source_call_card_id)
  where source_call_card_id is not null;

-- Migration 106 installs same-tenant guards from the live FK catalog. Rerun
-- the installer so this later relationship receives the same database guard.
select public.install_tenant_reference_guards();
