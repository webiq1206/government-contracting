-- Sender identity now comes from the connected Gmail inbox, not a DNS-verified
-- Resend domain. Outreach is sent by the tenant's own mailbox, so the address
-- is whatever they authorized, optionally overridden by a Gmail "Send mail as"
-- alias they have already proved to Google.

-- The address to put in From. Must be the authorized account or one of its
-- verified aliases; Gmail rejects anything else, which is the check we want.
alter table integration_tokens
  add column if not exists send_as text;

-- Display name subcontractors see in their inbox list.
alter table integration_tokens
  add column if not exists display_name text;

-- Resend is gone, and with it per-tenant sending domains. Dropping rather than
-- leaving an orphan table: it briefly shipped, so a deployment that ran 034
-- needs an explicit drop to converge with a fresh install.
drop table if exists organization_sending_domains;
