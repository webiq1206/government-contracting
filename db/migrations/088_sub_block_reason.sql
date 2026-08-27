-- A "do not use" mark that says why, and that somebody can actually set.
--
-- `blacklisted` was a bare boolean with no reason, no actor and no date, and
-- no write path anywhere in the application: it could only be set by hand in
-- SQL. So the strongest statement the roster can make about a firm was one
-- nobody could make, and one nobody could explain or lift with any
-- confidence. On federal work that statement usually has a story behind it
-- (walked off a job, failed a background check, an owner nobody will work
-- with again), and the story is the part that matters when somebody two years
-- later asks whether it still applies.

alter table subcontractors
  add column if not exists blacklist_reason text,
  add column if not exists blacklisted_at   timestamptz,
  add column if not exists blacklisted_by   uuid references users(id) on delete set null;

-- Not valid, deliberately. Rows blocked before this migration have no reason
-- to give, and inventing one would be worse than the gap. They stay as they
-- are and read as "No reason was recorded"; every block set from now on has
-- to carry one.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subcontractors_blacklist_reason_ck'
  ) then
    alter table subcontractors
      add constraint subcontractors_blacklist_reason_ck
      check (blacklisted = false or length(btrim(coalesce(blacklist_reason, ''))) >= 3)
      not valid;
  end if;
end $$;

create index if not exists subcontractors_blacklisted_idx
  on subcontractors (org_id)
  where blacklisted = true;
