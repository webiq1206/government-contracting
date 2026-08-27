-- Real files on a compliance item, rather than a pasted link.
--
-- The item had a `doc_url` whose placeholder said "e.g. a Drive link". That is
-- a pointer to a file somewhere else, which stops working when somebody
-- leaves, moves a folder, or tightens a share setting, and it cannot be
-- produced in an audit. The subcontractor side has stored files with a
-- verification trail; the company's own registrations, certifications and
-- insurance did not.
--
-- A table rather than a column on the item, because one obligation routinely
-- has several files: a policy and its endorsement, a certificate and the
-- letter that corrects it.

create table if not exists compliance_item_documents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  item_id           uuid not null references compliance_items(id) on delete cascade,
  storage_path      text not null,
  original_filename text not null,
  mime_type         text not null,
  size_bytes        bigint,
  -- What this file is, when somebody says. Null is honest: a scan attached in
  -- a hurry is still better than no scan.
  kind              text,
  note              text,
  uploaded_by       uuid references users(id) on delete set null,
  uploaded_at       timestamptz not null default now(),
  -- Superseded rather than deleted, so a replaced certificate is still
  -- producible: what was on file at the time is the question an audit asks.
  superseded_by     uuid references compliance_item_documents(id) on delete set null,
  constraint compliance_item_documents_path_ck check (length(btrim(storage_path)) > 0),
  constraint compliance_item_documents_name_ck check (length(btrim(original_filename)) > 0),
  constraint compliance_item_documents_not_self_ck check (superseded_by is null or superseded_by <> id)
);

create index if not exists compliance_item_documents_item_idx
  on compliance_item_documents (item_id, uploaded_at desc);

/*
 * The links people already pasted, carried across as a record of where the
 * file was said to be.
 *
 * Not treated as an uploaded file: nothing was stored, and pretending
 * otherwise would put a row in this table whose storage_path resolves to
 * nothing. The note says what it is.
 */
alter table compliance_items
  add column if not exists doc_url_note text;

update compliance_items
   set doc_url_note = 'Linked from ' || doc_url
 where doc_url is not null and btrim(doc_url) <> '' and doc_url_note is null;
