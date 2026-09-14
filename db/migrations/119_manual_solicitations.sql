-- Solicitations a person adds by hand, by URL, or by upload.
--
-- source_url keeps the original link so the record can always be checked
-- against where it came from. import_meta records how the record arrived
-- (method, who, when), which fields were retrieved from the source versus
-- typed in versus inferred by AI, and whether the platform keeps watching
-- the source for changes. Both stay null for rows the monitor ingests.
alter table opportunities add column if not exists source_url text;
alter table opportunities add column if not exists import_meta jsonb;
