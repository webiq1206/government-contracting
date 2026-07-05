-- 003: performance indexes + schema documentation from the pre-launch audit.
-- All monetary columns in this database store WHOLE US DOLLARS, never cents.

-- Call Queue: filtered index for the pending-cards view (status + join key).
create index if not exists call_cards_pending_opp_idx
  on call_cards (status, opportunity_id)
  where status = 'pending';

-- Call Workspace history: composite lookup by (sub, opp).
create index if not exists communications_sub_opp_idx
  on communications (subcontractor_id, opportunity_id, created_at desc);

create index if not exists quotes_sub_opp_idx
  on quotes (subcontractor_id, opportunity_id, created_at desc);

-- Activity feed + KPI snapshot lookup.
create index if not exists agent_logs_agent_created_idx
  on agent_logs (agent, created_at desc);

-- Deadline monitor + pipeline board ordering.
create index if not exists opportunities_open_deadline_idx
  on opportunities (deadline)
  where status = 'open';

-- Document the money units so no future writer assumes cents.
comment on column opportunities.value_estimated is 'Estimated contract value in whole US dollars (not cents).';
comment on column quotes.quote_amount is 'Subcontractor quote in whole US dollars (not cents).';
comment on column bids.bid_amount is 'Bid price in whole US dollars (not cents).';
comment on column bids.sub_quote_total is 'Sum of sub quotes in whole US dollars (not cents).';
comment on column bids.award_amount is 'Award amount in whole US dollars (not cents).';
comment on column contracts.award_amount is 'Contract award amount in whole US dollars (not cents).';

-- The "always required" comment on contracts.backup_sub_id was wrong: the
-- column is nullable by design (a backup sub is strongly recommended, not
-- schema-enforced, because contracts can be recorded before subs are lined up).
comment on column contracts.backup_sub_id is 'Backup subcontractor (recommended; nullable because a contract can be recorded before the backup is confirmed).';

-- Keep the utilization percentage sane (0-100).
alter table contracts drop constraint if exists contracts_non_ss_sub_pct_range;
alter table contracts add constraint contracts_non_ss_sub_pct_range
  check (non_ss_sub_pct >= 0 and non_ss_sub_pct <= 100);
