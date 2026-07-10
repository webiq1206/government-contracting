-- Distinguish operator-created compliance items from ones the Compliance Monitor
-- manages. The monitor only ever touches its own rows (source = 'monitor'), so a
-- manually added item is never overwritten or removed by the daily run.
alter table compliance_items add column if not exists source text not null default 'monitor';
create index if not exists compliance_items_source_idx on compliance_items (source);
