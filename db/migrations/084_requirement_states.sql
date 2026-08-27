-- Where each submission requirement has got to, and who says so.
--
-- The checklist could say what the solicitation asks for and could not say
-- whether anybody had done it. Everything downstream inherited that: the
-- readiness figure counted documents rather than obligations, and an operator
-- looking at forty extracted requirements had no way to record that eleven
-- were handled last Tuesday, so the next person started again.
--
-- Two tables, and the split is deliberate. The first is the current state,
-- which is what a page reads. The second is every change that produced it,
-- which is what an audit reads, and it is append-only: a compliance record
-- that can be edited afterwards is a record of what somebody wanted to have
-- happened.

create table if not exists requirement_states (
  org_id uuid not null references organizations(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  -- The requirement's stable id from the extraction, not a row number. A
  -- re-analysis that reorders the list must not move everybody's progress.
  requirement_id text not null,
  state text not null default 'not_started'
    check (state in ('not_started','in_progress','needs_clarification','blocked','done','not_applicable')),
  -- What proving it actually takes. Defaults to needing an upload rather than
  -- to needing nothing: the safe direction is asking a person for something
  -- unnecessary, not quietly deciding nobody needs to be asked.
  verification text not null default 'upload'
    check (verification in ('none','signature','credential','upload','portal_action')),
  -- Whether a person has confirmed the requirement was read correctly. An
  -- extracted requirement is a model's reading of a document, and closing one
  -- out on the strength of that same reading is a system marking its own
  -- homework.
  human_verified boolean not null default false,
  -- Who here is doing it. Null is unassigned, which is a real answer.
  owner_id uuid references users(id) on delete set null,
  -- This requirement's own date, which is not the bid's: a licence that has to
  -- be current at award and a form due with the proposal are different
  -- deadlines and the earlier one is not always the obvious one.
  due_at timestamptz,
  -- Why it is stuck, in the words of whoever set it. Required by the check
  -- below when the state claims something is stopping it, because "blocked"
  -- with no reason is a row that tells the next person nothing.
  blocking_reason text,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null,
  primary key (opportunity_id, requirement_id),
  check (
    state not in ('blocked','needs_clarification')
    or coalesce(btrim(blocking_reason), '') <> ''
  )
);

create index if not exists requirement_states_owner_idx
  on requirement_states (org_id, owner_id) where owner_id is not null;

create index if not exists requirement_states_due_idx
  on requirement_states (org_id, due_at) where due_at is not null;

-- Every change, kept.
create table if not exists requirement_state_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  requirement_id text not null,
  from_state text,
  to_state text not null,
  -- 'person' or 'automation', and the actor when it was a person. Which of the
  -- two acted is the first question anybody asks of a compliance trail.
  actor_kind text not null check (actor_kind in ('person','automation')),
  actor_id uuid references users(id) on delete set null,
  actor_label text,
  note text,
  at timestamptz not null default now()
);

create index if not exists requirement_state_events_lookup_idx
  on requirement_state_events (opportunity_id, requirement_id, at desc);

-- Append-only, enforced rather than intended.
--
-- The DELETE branch allows the cascade from a deleted opportunity: a customer
-- deleting their account must not be blocked by their own audit trail, and the
-- rows are meaningless without the record they describe.
create or replace function requirement_state_events_immutable() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'requirement_state_events rows cannot be changed once written';
  end if;
  if tg_op = 'DELETE' and exists (select 1 from opportunities where id = old.opportunity_id) then
    raise exception 'requirement_state_events rows cannot be deleted while the opportunity exists';
  end if;
  return old;
end;
$$ language plpgsql;

drop trigger if exists requirement_state_events_append_only on requirement_state_events;
create trigger requirement_state_events_append_only
  before update or delete on requirement_state_events
  for each row execute function requirement_state_events_immutable();
