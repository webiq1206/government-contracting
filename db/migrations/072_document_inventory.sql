-- One complete source inventory per opportunity.
--
-- The question an operator has about a solicitation is not "how many
-- documents are there", it is "is there anything in this bid I have not
-- seen". Nothing in `documents` could answer it. The table recorded that a
-- file existed and where the bytes went, and everything else, whether the
-- text was ever read, whether an amendment replaced it, whether the link
-- still works, lived either in a jsonb blob or nowhere at all.
--
-- So a document that downloaded cleanly and was then dropped for want of room
-- in the analysis prompt was indistinguishable, on every screen and in every
-- query, from one that was read cover to cover.
--
-- Every column below is nullable with no default beyond the two states that
-- must fail closed. Backfilling would mean inventing facts about files this
-- code has already processed: nothing in an existing row says whether its text
-- reached an analysis, and guessing "extracted" is exactly the lie this
-- migration exists to stop. Existing rows read as `pending`, which is true.

alter table documents
  -- Where it came from. `meta->>'source_url'` held this for solicitation
  -- attachments only, unindexed and unqueryable.
  add column if not exists source_system     text,
  add column if not exists source_url        text,
  add column if not exists original_filename text,

  -- Identity of the bytes, so a re-fetch can tell "unchanged" from "amended"
  -- without re-reading the whole file.
  add column if not exists content_hash      text,
  add column if not exists byte_size         bigint,
  add column if not exists page_count        integer,

  -- solicitation | amendment | drawing | specification | pricing_schedule |
  -- wage_determination | form | exhibit | photo | map | archive | other
  add column if not exists document_class    text,
  -- The amendment this file carries, when its name declares one. Null is not
  -- zero: "no amendment number" and "amendment 0" are different facts.
  add column if not exists amendment_number  integer,
  -- The document that replaced this one. Set on the OLD row, so history is
  -- kept rather than overwritten.
  add column if not exists superseded_by     uuid references documents(id) on delete set null,

  -- delivered | delivered_via_link | excluded | blocked
  --
  -- Exactly one per source file, and no row may sit outside the list. This is
  -- the column that makes "nothing was silently skipped" a query rather than
  -- a hope, which is why it fails closed: a row that never got one reads as
  -- blocked, not as delivered.
  add column if not exists disposition       text not null default 'blocked',
  -- Required when disposition is 'excluded'. An exclusion with no reason is
  -- indistinguishable from a file that was quietly lost.
  add column if not exists excluded_reason   text,
  add column if not exists excluded_by       text,
  add column if not exists excluded_at       timestamptz,

  -- pending | extracted | partial | not_read | unreadable | not_applicable
  add column if not exists extraction_state  text not null default 'pending',
  -- not_needed | pending | done | partial | failed
  add column if not exists ocr_state         text,
  -- available | link_expired | unreachable | protected
  add column if not exists access_state      text,

  -- Which model and prompt produced the extraction, so a document read by an
  -- older version can be found and reprocessed rather than trusted forever.
  add column if not exists extraction_model    text,
  add column if not exists extraction_version  integer,
  add column if not exists extracted_at        timestamptz,

  add column if not exists received_at       timestamptz,
  add column if not exists last_verified_at  timestamptz,

  -- Trades this document matters to, and whether it matters to everyone.
  -- A subcontractor should not be sent two hundred pages of another trade's
  -- specification to find their own six.
  add column if not exists trade_relevance   jsonb,
  add column if not exists relevant_to_all   boolean,

  -- Why the last attempt failed and how many there have been, so a retry is a
  -- decision rather than a reflex.
  add column if not exists last_error        text,
  add column if not exists retry_count       integer not null default 0,

  -- Set when a person has looked at a conflict or an unreadable file and said
  -- what is true. Distinct from any automated state.
  add column if not exists reviewed_by       text,
  add column if not exists reviewed_at       timestamptz,
  add column if not exists review_note       text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_disposition_ck') then
    alter table documents add constraint documents_disposition_ck
      check (disposition in ('delivered','delivered_via_link','excluded','blocked'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_extraction_state_ck') then
    alter table documents add constraint documents_extraction_state_ck
      check (extraction_state in ('pending','extracted','partial','not_read','unreadable','not_applicable'));
  end if;
  -- An exclusion must carry a reason. Enforced here rather than in the API so
  -- a future caller cannot route around it.
  if not exists (select 1 from pg_constraint where conname = 'documents_excluded_reason_ck') then
    alter table documents add constraint documents_excluded_reason_ck
      check (disposition <> 'excluded' or coalesce(btrim(excluded_reason), '') <> '');
  end if;
end $$;

-- The inventory query: everything for one opportunity, ordered.
create index if not exists documents_inventory_idx
  on documents (opportunity_id, document_class, amendment_number);

-- "Which documents on this account still need somebody?" One index, because
-- this is the query behind the blocker counts on every screen.
create index if not exists documents_unresolved_idx
  on documents (org_id, opportunity_id)
  where disposition <> 'delivered' or extraction_state <> 'extracted';

-- Re-fetch comparison: has this file changed since we last read it?
create index if not exists documents_content_hash_idx
  on documents (opportunity_id, content_hash)
  where content_hash is not null;

-- Superseded lookups run in both directions: what replaced this, and what did
-- this replace.
create index if not exists documents_superseded_idx
  on documents (superseded_by)
  where superseded_by is not null;
