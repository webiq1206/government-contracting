-- Operator-owned fields on compliance items. The Compliance Monitor only writes
-- due_at, status, days_remaining, detail, and last_checked_at, so these survive
-- every automated run. An override date/status, when set, wins over the
-- monitor's on the board.
alter table compliance_items add column if not exists notes text;
alter table compliance_items add column if not exists link_url text;         -- renewal portal / reference link
alter table compliance_items add column if not exists doc_url text;          -- link to the certificate / policy document
alter table compliance_items add column if not exists due_at_override timestamptz;
alter table compliance_items add column if not exists status_override text;  -- ok | warning | critical | blocked | resolved
