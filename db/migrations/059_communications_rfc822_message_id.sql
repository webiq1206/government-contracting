-- Keep follow-ups on the original email thread.
--
-- `communications.gmail_message_id` holds Gmail's internal API handle
-- ("18f2a3b..."). That is NOT the RFC822 Message-ID header
-- ("<CAF...@mail.gmail.com>"), and only the latter can go in In-Reply-To /
-- References -- the headers a RECIPIENT's mail client uses to thread a reply.
--
-- Gmail's threadId keeps a follow-up tidy in OUR mailbox, which is what the
-- in-app conversation view reads. It does nothing for the subcontractor: on
-- Outlook, Apple Mail or anything else, every follow-up arrived as a brand
-- new, context-free message with none of the original scope or attachments
-- above it. Storing the real Message-ID is what lets the next send thread
-- properly everywhere.
--
-- Nullable and backfill-free on purpose: rows written before this exist
-- without one, and a follow-up to those still threads via threadId alone
-- rather than failing.
alter table communications add column if not exists rfc822_message_id text;

create index if not exists communications_rfc822_message_id_idx
  on communications (rfc822_message_id)
  where rfc822_message_id is not null;
