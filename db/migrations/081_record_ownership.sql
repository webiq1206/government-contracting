-- Who on the team a piece of work is on.
--
-- The queue could already say when the next move belonged to somebody outside
-- the company: `waiting_on` covers the subcontractor who has not quoted and
-- the agency that has not answered. What it could not say is which of the
-- three people in this office is doing it.
--
-- On a one-person account that question has an obvious answer and nobody asks
-- it. On a five-person account it is the question, and its absence has a
-- specific failure mode: everything looks like it is on everybody, so the
-- overdue items are the ones each person assumed the other had.
--
-- Assignment lives on the record rather than in a table of its own, because
-- the tasks in this product are derived. A task is a view of an opportunity or
-- a compliance item at a moment; it has no independent existence to hang an
-- owner off, and an assignment stored against a derived id would be lost the
-- next time the derivation ran. Put on the record, the owner survives, and it
-- means the same thing everywhere the record appears.
--
-- Nullable everywhere, and null means unassigned rather than unknown. That is
-- the honest default: nobody has said whose it is. The interface prints
-- "Unassigned", never a guess and never the account owner's name because they
-- happened to sign up.

alter table opportunities   add column if not exists assigned_to uuid references users(id) on delete set null;
alter table opportunities   add column if not exists assigned_at timestamptz;
alter table opportunities   add column if not exists assigned_by uuid references users(id) on delete set null;

alter table compliance_items add column if not exists assigned_to uuid references users(id) on delete set null;
alter table compliance_items add column if not exists assigned_at timestamptz;
alter table compliance_items add column if not exists assigned_by uuid references users(id) on delete set null;

alter table contracts       add column if not exists assigned_to uuid references users(id) on delete set null;
alter table contracts       add column if not exists assigned_at timestamptz;
alter table contracts       add column if not exists assigned_by uuid references users(id) on delete set null;

-- The subcontractor's internal owner: the person here who knows this firm.
alter table subcontractors  add column if not exists assigned_to uuid references users(id) on delete set null;
alter table subcontractors  add column if not exists assigned_at timestamptz;
alter table subcontractors  add column if not exists assigned_by uuid references users(id) on delete set null;

-- `on delete set null` rather than restrict or cascade. A person leaving must
-- not delete their opportunities and must not be undeletable because of them;
-- their work becomes unassigned, which is exactly what has happened.

-- An owner has to be somebody who can see the record.
--
-- A foreign key to users cannot say this: it permits any user in the platform,
-- which would let one organization's record name a person in another as its
-- owner. That is a cross-tenant reference, and it would show that person's
-- name on a screen they have no business appearing on. The constraint has to
-- consult organization_members, so it is a trigger.
create or replace function assigned_to_must_be_member() returns trigger as $$
begin
  if new.assigned_to is null then
    -- Unassigning is always allowed, and clears the trail with it.
    new.assigned_at := null;
    new.assigned_by := null;
    return new;
  end if;
  if not exists (
    select 1 from organization_members m
     where m.org_id = new.org_id and m.user_id = new.assigned_to
  ) then
    raise exception 'assigned_to must be a member of the record''s organization';
  end if;
  if new.assigned_by is not null and not exists (
    select 1 from organization_members m
     where m.org_id = new.org_id and m.user_id = new.assigned_by
  ) then
    raise exception 'assigned_by must be a member of the record''s organization';
  end if;
  if new.assigned_at is null then new.assigned_at := now(); end if;
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['opportunities','compliance_items','contracts','subcontractors'] loop
    execute format('drop trigger if exists %I_assignee_member on %I', t, t);
    execute format(
      'create trigger %I_assignee_member before insert or update of assigned_to, assigned_by on %I
         for each row execute function assigned_to_must_be_member()', t, t);
  end loop;
end $$;

-- "What is on me" is the commonest read of every one of these lists, and it
-- is a filter rather than a scan.
create index if not exists opportunities_assigned_to_idx   on opportunities (org_id, assigned_to) where assigned_to is not null;
create index if not exists compliance_items_assigned_to_idx on compliance_items (org_id, assigned_to) where assigned_to is not null;
create index if not exists contracts_assigned_to_idx        on contracts (org_id, assigned_to) where assigned_to is not null;
create index if not exists subcontractors_assigned_to_idx   on subcontractors (org_id, assigned_to) where assigned_to is not null;
