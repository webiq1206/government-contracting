-- A browser retry must find the original attempt, never issue another send.
-- Existing history is preserved without guessing missing receipts or identities.
alter table communications add column if not exists request_key uuid;
alter table communications add column if not exists request_fingerprint text;
alter table communications add column if not exists sender_email text;
alter table communications add column if not exists provider_attempted_at timestamptz;
alter table communications add column if not exists provider_accepted_at timestamptz;
create unique index if not exists communications_request_key_unique
  on communications (org_id, request_key) where request_key is not null;
alter table communications drop constraint if exists communications_delivery_state_check;
alter table communications add constraint communications_delivery_state_check
  check (delivery_state in ('sent','delivered','bounced','deferred','failed','draft','held','queued','attempting','unknown'));

-- Reauthorization establishes a new cursor owner, including same-mailbox grants.
alter table integration_tokens add column if not exists connection_generation uuid not null default gen_random_uuid();
