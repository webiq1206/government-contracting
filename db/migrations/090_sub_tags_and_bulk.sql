-- Tags, and a record of every bulk change so one can be taken back.
--
-- Bulk verify, tag and archive were left unbuilt on purpose: they each write
-- to a roster shared across live bids, and a button that changes two hundred
-- rows with no way back is worse than no button. So the batch itself is the
-- record. Every bulk write stores which rows it touched and what it did to
-- them, and undoing is replaying that in reverse rather than guessing.

create table if not exists subcontractor_tags (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  subcontractor_id  uuid not null references subcontractors(id) on delete cascade,
  tag               text not null,
  created_at        timestamptz not null default now(),
  created_by        uuid references users(id) on delete set null,
  constraint subcontractor_tags_tag_ck
    check (length(btrim(tag)) between 1 and 40)
);

-- Case-insensitive, so "Preferred HVAC" and "preferred hvac" are one tag
-- rather than two that each match half the roster.
create unique index if not exists subcontractor_tags_unique_idx
  on subcontractor_tags (subcontractor_id, lower(tag));

create index if not exists subcontractor_tags_lookup_idx
  on subcontractor_tags (org_id, lower(tag));

create table if not exists subcontractor_bulk_actions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  kind         text not null,
  -- What the operator asked for, kept so the log line can say it in their
  -- words rather than reconstructing it.
  detail       text,
  -- The rows this actually changed, and only those. A batch that asked for
  -- 200 and changed 173 must not offer to undo 200.
  affected     jsonb not null default '[]'::jsonb,
  -- Rows that were named and skipped, with why. Shown rather than swallowed:
  -- "27 were not changed" with no reason is how somebody stops trusting the
  -- number.
  skipped      jsonb not null default '[]'::jsonb,
  actor_id     uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  undone_at    timestamptz,
  undone_by    uuid references users(id) on delete set null,
  constraint subcontractor_bulk_actions_kind_ck
    check (kind in ('verify','tag','untag','archive')),
  -- A batch that changed nothing has nothing to undo, and should not look
  -- like it does.
  constraint subcontractor_bulk_actions_undo_ck
    check (undone_at is null or jsonb_array_length(affected) > 0)
);

create index if not exists subcontractor_bulk_actions_org_idx
  on subcontractor_bulk_actions (org_id, created_at desc);
