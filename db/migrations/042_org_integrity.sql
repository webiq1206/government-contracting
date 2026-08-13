-- Organization integrity: every tenant-owned row carries its org, always.
--
-- 028 gave the tables an org_id and backfilled what existed then. What it did
-- not do is make the column self-maintaining: two dozen insert sites across
-- routes and agents write child rows (contracts, quotes, documents,
-- communications, ...) without setting org_id, so rows created since the
-- backfill can be orphaned. An orphaned row is invisible to any org-scoped
-- query, which turns tenant scoping from a security boundary into a data-loss
-- bug: scope the API (043 territory) and the orphans silently vanish from the
-- product.
--
-- The fix is enforced here, in the database, rather than by editing every
-- insert site: a child row's org is its parent's org, and a BEFORE INSERT
-- trigger derives it when the caller did not supply it. Code that already
-- sets org_id explicitly is untouched (the trigger only fills nulls), and
-- code written next year cannot reintroduce the bug.

-- ---------------------------------------------------------------------------
-- 1. Repair: adopt orphans into their parent's org.
-- ---------------------------------------------------------------------------

update contracts c set org_id = o.org_id
  from opportunities o
 where c.opportunity_id = o.id and c.org_id is null and o.org_id is not null;

update documents d set org_id = o.org_id
  from opportunities o
 where d.opportunity_id = o.id and d.org_id is null and o.org_id is not null;

update quotes q set org_id = o.org_id
  from opportunities o
 where q.opportunity_id = o.id and q.org_id is null and o.org_id is not null;

update bids b set org_id = o.org_id
  from opportunities o
 where b.opportunity_id = o.id and b.org_id is null and o.org_id is not null;

update call_cards cc set org_id = o.org_id
  from opportunities o
 where cc.opportunity_id = o.id and cc.org_id is null and o.org_id is not null;

update pricing_comps pc set org_id = o.org_id
  from opportunities o
 where pc.opportunity_id = o.id and pc.org_id is null and o.org_id is not null;

-- Communications hang off an opportunity, a subcontractor, or both.
update communications c set org_id = o.org_id
  from opportunities o
 where c.opportunity_id = o.id and c.org_id is null and o.org_id is not null;

update communications c set org_id = s.org_id
  from subcontractors s
 where c.subcontractor_id = s.id and c.org_id is null and s.org_id is not null;

update subcontractor_documents d set org_id = s.org_id
  from subcontractors s
 where d.subcontractor_id = s.id and d.org_id is null and s.org_id is not null;

update subcontractor_payments p set org_id = s.org_id
  from subcontractors s
 where p.subcontractor_id = s.id and p.org_id is null and s.org_id is not null;

-- Root tables have no parent to inherit from. Anything still unowned predates
-- multi-tenancy and belongs to the founding org, same as 028's backfill.
update compliance_items set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update content_library  set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update custom_kpis      set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update templates        set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;

-- ---------------------------------------------------------------------------
-- 2. Prevention: derive a child's org from its parent on insert.
-- ---------------------------------------------------------------------------

create or replace function derive_org_from_opportunity() returns trigger as $$
begin
  if new.org_id is null and new.opportunity_id is not null then
    select org_id into new.org_id from opportunities where id = new.opportunity_id;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function derive_org_from_subcontractor() returns trigger as $$
begin
  if new.org_id is null and new.subcontractor_id is not null then
    select org_id into new.org_id from subcontractors where id = new.subcontractor_id;
  end if;
  return new;
end;
$$ language plpgsql;

-- Communications: try the opportunity first, then the subcontractor.
create or replace function derive_org_for_communication() returns trigger as $$
begin
  if new.org_id is null and new.opportunity_id is not null then
    select org_id into new.org_id from opportunities where id = new.opportunity_id;
  end if;
  if new.org_id is null and new.subcontractor_id is not null then
    select org_id into new.org_id from subcontractors where id = new.subcontractor_id;
  end if;
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array['contracts','documents','quotes','bids','call_cards','pricing_comps']
  loop
    execute format('drop trigger if exists %I on %I', t || '_derive_org', t);
    execute format(
      'create trigger %I before insert on %I for each row execute function derive_org_from_opportunity()',
      t || '_derive_org', t
    );
  end loop;
end $$;

drop trigger if exists subcontractor_documents_derive_org on subcontractor_documents;
create trigger subcontractor_documents_derive_org
  before insert on subcontractor_documents
  for each row execute function derive_org_from_subcontractor();

drop trigger if exists subcontractor_payments_derive_org on subcontractor_payments;
create trigger subcontractor_payments_derive_org
  before insert on subcontractor_payments
  for each row execute function derive_org_from_subcontractor();

drop trigger if exists communications_derive_org on communications;
create trigger communications_derive_org
  before insert on communications
  for each row execute function derive_org_for_communication();
