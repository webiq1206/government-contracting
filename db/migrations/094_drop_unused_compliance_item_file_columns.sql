-- Remove the single-file columns that 093 replaced, before anything writes them.
--
-- 091 added compliance_items.storage_path / original_filename / mime_type on
-- the assumption that an item has one document. It does not: an insurance
-- obligation has a policy and its endorsement, a certification has the
-- certificate and the letter that corrects it, which is why 093 created
-- compliance_item_documents.
--
-- Leaving the columns behind would give a file two places to live, one of
-- which nothing writes. Every read would have to guess which was authoritative,
-- and the answer would be "the one that is always null" often enough to matter.
-- Nothing has ever written them, so nothing is lost here.

alter table compliance_items
  drop column if exists storage_path,
  drop column if exists original_filename,
  drop column if exists mime_type;
