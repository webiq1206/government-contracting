-- When the AI compliance audit last actually completed.
--
-- `audit_status` says what the most recent RUN did, and `audit_findings` holds
-- what is currently known. Neither says when the findings were produced, and
-- once a run can be skipped without discarding the previous run's findings,
-- that date is the difference between "three blockers" and "three blockers,
-- found on 24 August, and today's re-read could not run".
--
-- Null means the AI pass has never completed for this bid. That is not the
-- same as a clean audit and must never be rendered as one: an account with no
-- AI key reaches submission on the deterministic checks alone, and the page
-- has to be able to say so rather than leave the space blank.
alter table bids
  add column if not exists audit_ran_at timestamptz;

-- Existing bids are left null rather than backfilled from updated_at. The
-- audit is one of several things that write to a bid row, so updated_at would
-- date the audit to whatever last touched the record, which is a plausible
-- wrong answer and worse than an honest absence.
