-- Merging duplicate subcontractors, and putting one aside without losing it.
--
-- A roster built partly by hand and partly by a sourcing agent accumulates the
-- same firm twice: "Ridgeline Mechanical" and "Ridgeline Mechanical LLC", one
-- with the phone number and one with the email, half the history on each. The
-- only tool for that was deleting one, which takes its emails, quotes,
-- pairings, documents and compliance records with it, and those are the record
-- of who was approached for a federal bid.
--
-- So nothing is deleted here. A merge repoints the history onto the surviving
-- record and leaves the other one standing as a tombstone that points at it, so
-- an old link still resolves and an old id in somebody's notes still means
-- something. An archive is the same idea for a firm that is simply not used any
-- more.

-- Which record this one was folded into. Null for every ordinary row.
alter table subcontractors
  add column if not exists merged_into uuid references subcontractors(id) on delete set null;

-- Put aside, with the reason and who did it. Not deleted, and not blocked
-- either: "we do not work with these any more" and "do not use, here is why"
-- are different statements and the roster shows them differently.
alter table subcontractors
  add column if not exists archived_at timestamptz;
alter table subcontractors
  add column if not exists archived_reason text;
alter table subcontractors
  add column if not exists archived_by uuid references users(id) on delete set null;

alter table subcontractors
  drop constraint if exists subcontractors_archive_reason_ck;
alter table subcontractors
  add constraint subcontractors_archive_reason_ck check (
    archived_at is null or coalesce(btrim(archived_reason), '') <> ''
  );

-- A merged record is archived by definition: it is not a firm any more, it is
-- a pointer. Enforced so the roster's default filter cannot be fooled by a
-- merge that forgot to set one of the two.
alter table subcontractors
  drop constraint if exists subcontractors_merged_is_archived_ck;
alter table subcontractors
  add constraint subcontractors_merged_is_archived_ck check (
    merged_into is null or archived_at is not null
  );

-- And it cannot point at itself, which would make the survivor lookup loop.
alter table subcontractors
  drop constraint if exists subcontractors_merged_not_self_ck;
alter table subcontractors
  add constraint subcontractors_merged_not_self_ck check (merged_into is distinct from id);

create index if not exists subcontractors_active_idx
  on subcontractors (org_id) where archived_at is null;

create index if not exists subcontractors_merged_idx
  on subcontractors (merged_into) where merged_into is not null;

-- What a merge did, in enough detail to undo it.
--
-- `moved` holds the row ids that were repointed, per table. That is what makes
-- an undo real rather than a promise: putting the record back is easy, and
-- putting its emails back with it is only possible if somebody wrote down
-- which ones moved.
--
-- A merge that moves more history than fits is still allowed, and recorded as
-- irreversible with the reason. The operator is told before they commit, which
-- is the only honest way to offer an undo that has a limit.
create table if not exists subcontractor_merges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  survivor_id uuid not null references subcontractors(id) on delete cascade,
  merged_id uuid not null references subcontractors(id) on delete cascade,
  -- The whole losing row as it stood, so an undo restores the fields as well
  -- as the record, and so a reader can see what was lost to a field decision.
  merged_snapshot jsonb not null,
  -- Which value won for each field where the two disagreed, and why.
  field_decisions jsonb not null default '{}'::jsonb,
  -- { "communications": ["uuid", ...], ... }
  moved jsonb not null default '{}'::jsonb,
  reversible boolean not null default true,
  irreversible_reason text,
  actor_id uuid references users(id) on delete set null,
  actor_email text,
  at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references users(id) on delete set null,
  check (reversible or coalesce(btrim(irreversible_reason), '') <> ''),
  check (survivor_id <> merged_id)
);

create index if not exists subcontractor_merges_survivor_idx
  on subcontractor_merges (org_id, survivor_id, at desc);

create index if not exists subcontractor_merges_merged_idx
  on subcontractor_merges (merged_id);
