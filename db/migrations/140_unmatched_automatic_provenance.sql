-- Preserve original automation provenance when an inbox message waits for
-- manual assignment. Assigning its conversation must not turn an automatic
-- notice into a supplier decision. Older rows remain unknown; no backfill.
alter table unmatched_inbound add column auto_submitted text;
