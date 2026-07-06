-- 007: compliance hardening.
-- Persist the parsed solicitation text so the independent auditor can re-read
-- it without re-downloading attachments, and store audit findings on the bid.
alter table opportunities add column if not exists solicitation_text text;

alter table bids add column if not exists audit_findings jsonb;   -- AuditFinding[]
alter table bids add column if not exists audit_status   text;     -- pending | clean | issues | skipped

comment on column opportunities.solicitation_text is 'Concatenated parsed text of the solicitation + attachments, capped, for re-audit.';
comment on column bids.audit_findings is 'Independent compliance-auditor findings (missing/non-compliant items).';
comment on column bids.audit_status is 'pending | clean | issues | skipped.';
