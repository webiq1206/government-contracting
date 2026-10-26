-- The account's own IANA zone for outreach business hours.
--
-- Null means never chosen. Every send-window reader treats null, blank, and
-- any name Intl does not recognise as America/Boise. That fallback is the
-- product default for quote requests, follow-ups, sources-sought sends, and
-- backlink outreach. It is not UTC, not the worker process zone, and not the
-- recap default (America/Denver).
--
-- Personal recap zones stay on users.timezone. This column is the account
-- clock: Monday–Friday 09:00–16:59 in this zone. Nothing is deleted.

alter table organizations add column if not exists timezone text;
