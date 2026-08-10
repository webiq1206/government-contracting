-- Explicit per-sub contactability outcome so a missing email is never silent.
-- contact_status: 'verified' | 'unverified' | 'no_email_found' | 'no_website' | null (never checked)
-- email_source:   'hunter' | 'website_scrape' | 'manual' | null
alter table subcontractors add column if not exists contact_status text;
alter table subcontractors add column if not exists email_source text;
-- When email discovery last ran, drives the bounded recheck sweep so failed
-- discoveries are retried once new inputs (keys/websites) become available.
alter table subcontractors add column if not exists contact_checked_at timestamptz;
