-- The account's own IANA zone for outreach business hours.
--
-- Send order is: a solid subcontractor state/city, then this column, then
-- America/Boise. Null means this account has not chosen. Readers treat null,
-- blank, and any name Intl does not recognise as America/Boise when the
-- recipient location is not itself one zone. That fallback is not UTC, not
-- the worker process zone, and not the recap default (America/Denver).
--
-- Personal recap zones stay on users.timezone. This column is the account
-- clock: Monday–Friday 09:00–16:59 in the resolved zone. Nothing is deleted.

alter table organizations add column if not exists timezone text;
