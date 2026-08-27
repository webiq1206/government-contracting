-- How the work actually went, written down by the person who saw it.
--
-- The reliability score measured two things: whether a subcontractor answers
-- email and whether they have ever given a price. Both are real signals and
-- neither is what anybody means by reliable. The question an operator actually
-- asks before putting a firm on a bid is whether the last job went well, and
-- the platform had nowhere to record the answer.
--
-- It cannot be inferred. A contract closing says the paperwork finished, not
-- that the crew turned up; an unanswered email says nothing about a wall. So
-- this is operator-entered, deliberately, and it is the only honest source for
-- it.
--
-- Kept as events rather than counters on the subcontractor row. Three reasons,
-- and the third is why it is not a column: an event carries when, an event
-- carries which job, and a counter cannot be argued with. Somebody who thinks
-- a firm has been marked down unfairly can read what was written and by whom.

create table if not exists subcontractor_performance_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,
  -- Which job this is about. Null is allowed: a firm can let you down on work
  -- that never became an opportunity in here, and refusing to record that
  -- would lose the fact rather than keep the schema tidy.
  opportunity_id uuid references opportunities(id) on delete set null,
  kind text not null check (kind in ('completed', 'issue', 'cancelled')),
  -- What happened, in the words of whoever was there. Required for anything
  -- other than a clean completion, because a mark against a firm with no
  -- reason attached is one nobody can check and nobody can lift.
  note text,
  recorded_by uuid references users(id) on delete set null,
  recorded_by_email text,
  at timestamptz not null default now(),
  -- Withdrawn rather than deleted. A retraction is itself a fact: somebody
  -- recorded a problem and later said it was not one, and both halves matter
  -- when the firm asks why they stopped being called.
  retracted_at timestamptz,
  retracted_reason text,
  retracted_by uuid references users(id) on delete set null,
  check (kind = 'completed' or coalesce(btrim(note), '') <> ''),
  check (retracted_at is null or coalesce(btrim(retracted_reason), '') <> '')
);

create index if not exists sub_performance_lookup_idx
  on subcontractor_performance_events (org_id, subcontractor_id, at desc);

create index if not exists sub_performance_live_idx
  on subcontractor_performance_events (subcontractor_id) where retracted_at is null;

-- The date a subcontractor was actually given for their quote.
--
-- Lateness can only be measured against a date somebody was told. The outreach
-- email has always computed one and put it in the body; nothing stored it, so
-- "did they quote on time" had no answer that was not a guess about what the
-- email said. Stamped at send, so the measurement is against the promise that
-- was made rather than against one worked out later from a deadline that may
-- since have moved.
alter table opportunity_subs
  add column if not exists quote_due_at timestamptz;

-- When their price actually arrived, so the comparison is a subtraction rather
-- than a join across three tables at read time.
alter table opportunity_subs
  add column if not exists quoted_at timestamptz;

-- Whether the quote covered the work that was asked for.
--
-- Null means nobody has looked, which is not the same as "no": a quote nobody
-- checked must not count against a firm's scope accuracy, and it must not
-- count for it either.
alter table opportunity_subs
  add column if not exists quote_full_scope boolean;

create index if not exists opportunity_subs_quote_timing_idx
  on opportunity_subs (subcontractor_id) where quote_due_at is not null;
