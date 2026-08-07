-- 019: Track WHERE an opportunity's estimated value came from, so the UI can
-- tell a SAM-published figure apart from a best-effort extraction and never
-- present a guess as if it were authoritative.
--   sam_award  - SAM's own award.amount field (rare on live solicitations)
--   extracted  - regex sweep of the notice's title/description
--   analysis   - Solicitation Analyst's read of the full text + attachments
alter table opportunities add column if not exists value_estimated_source text;
