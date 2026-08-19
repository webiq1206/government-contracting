-- Do-not-contact, enforced before any send.
--
-- A subcontractor who replied "take me off your list" was closed out on THAT
-- solicitation (outreach_state='declined') and then emailed again the moment
-- the next opportunity matched their trade. There was no suppression concept
-- anywhere: no flag, no list, no pre-send check. For a platform sending
-- commercial email at volume that is a compliance problem and a sender-
-- reputation problem at once -- repeated mail to someone who asked you to stop
-- is what generates spam complaints, and complaints are what move an entire
-- domain from the inbox to the spam folder for everyone.
--
-- Keyed on the email ADDRESS rather than the subcontractor id on purpose: the
-- same person can appear under several sub records (duplicates, a company
-- listed per trade), and the request was "stop emailing me", not "stop
-- emailing this row".
--
-- Scoped per organization, deliberately. Each tenant is a separate sender with
-- its own relationship and its own legal obligation; one tenant's opt-out is
-- neither the other's to honour nor the other's to see, which is also what the
-- isolation model requires everywhere else.
create table if not exists email_suppressions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  reason      text,
  -- who/what suppressed it: 'reply' (they asked), 'operator', 'bounce'
  source      text not null default 'operator',
  created_at  timestamptz not null default now()
);

-- One suppression per address per tenant; re-suppressing is a no-op upsert.
create unique index if not exists email_suppressions_org_email_idx
  on email_suppressions (org_id, lower(email));
