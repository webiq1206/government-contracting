-- When the operator was told an opportunity was about to expire.
--
-- The sweep dismissed review-tier records the moment their timer passed, with
-- no notice and no opt-in. An opportunity left over a weekend disappeared from
-- the board, and the only record was a line in a log nobody reads until
-- something has already gone wrong.
--
-- Two changes make that honest, and this column carries the second. The first
-- is a setting: auto-dismissal is off unless the organization turns it on. The
-- second is that even when it is on, the sweep warns before it acts, and an
-- automatic action needs somewhere to record that the warning was actually
-- issued. Without a column the sweep would either warn on every run, which is
-- noise, or trust that it had, which is the thing this whole pass exists to
-- stop.
--
-- Null means not warned. A record whose timer passes while this is null is
-- warned rather than dismissed, which costs one sweep interval and buys the
-- guarantee that nothing is ever removed without notice.
alter table opportunities add column if not exists review_warned_at timestamptz;

create index if not exists opportunities_review_expiry_idx
  on opportunities (org_id, review_expires_at)
  where tier = 'review' and human_action_required = true and review_expires_at is not null;
