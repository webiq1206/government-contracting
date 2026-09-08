-- Gmail's API message id is an identifier inside one mailbox. It is not a
-- platform-wide tenant key. The original idempotency indexes used only that
-- value, so the same opaque id in two connected inboxes could make the second
-- tenant's real reply disappear as a duplicate of the first tenant's.
--
-- Replace both indexes with organization-scoped versions. Keep a separate
-- guard for historical rows whose organization was never backfilled. Current
-- writers always provide org_id and use the scoped conflict target below.

drop index if exists public.communications_inbound_message_uniq;

create unique index communications_inbound_message_uniq
  on public.communications (org_id, gmail_message_id)
  where direction = 'inbound'
    and gmail_message_id is not null
    and org_id is not null;

create unique index if not exists communications_inbound_message_legacy_uniq
  on public.communications (gmail_message_id)
  where direction = 'inbound'
    and gmail_message_id is not null
    and org_id is null;

drop index if exists public.sub_reply_events_message_uniq;

create unique index sub_reply_events_message_uniq
  on public.subcontractor_reply_events (org_id, gmail_message_id)
  where gmail_message_id is not null
    and org_id is not null;

create unique index if not exists sub_reply_events_message_legacy_uniq
  on public.subcontractor_reply_events (gmail_message_id)
  where gmail_message_id is not null
    and org_id is null;

-- A message held for manual matching still has to become the same complete
-- inbound communication as an automatically matched one. Preserve the
-- Internet Message-ID and reference chain while it waits, otherwise a person
-- can place the reply but the next response cannot be threaded to it.
alter table public.unmatched_inbound
  add column if not exists rfc822_message_id text,
  add column if not exists rfc822_references jsonb not null default '[]'::jsonb,
  add column if not exists to_addresses text,
  add column if not exists cc_addresses text,
  add column if not exists attachment_names jsonb not null default '[]'::jsonb,
  add column if not exists unreadable_attachments jsonb not null default '[]'::jsonb;
