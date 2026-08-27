-- Inbound mail that arrived and could not be placed.
--
-- The poller already refuses to drop an unmatched reply silently: when the
-- sender is a subcontractor on the roster it writes a warning to `agent_logs`
-- saying a firm wrote back and we could not place it.
--
-- That is better than nothing and it is still the wrong home. An agent log is
-- a stream an operator reads when something is wrong with the automation, not
-- a queue of work; the line scrolls away, it carries no body, and the only
-- instruction it can give is "go and look in the mailbox". A subcontractor's
-- reply to a bid invitation is a customer message. It should be somewhere a
-- person can read it, place it, or say it is not ours, and it should still be
-- there tomorrow.
--
-- So: a table with a state, holding enough of the message to decide.

create table if not exists unmatched_inbound (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,

  from_email    text not null,
  from_name     text,
  subject       text,
  -- Bounded on write. Enough to recognise the message and decide where it
  -- belongs, not a second copy of the mailbox: this table exists to route
  -- messages, and the thread itself stays where it is.
  snippet       text,

  gmail_thread_id text,
  -- RFC Message-ID. Unique per organization, which is what makes a second
  -- poll of the same mailbox do nothing rather than pile up duplicates of a
  -- message somebody is already looking at.
  message_id    text,
  received_at   timestamptz not null default now(),

  -- Set when the sender is a known subcontractor. Null means the sender is a
  -- stranger, which is usually a newsletter and occasionally a firm writing
  -- from an address we have never seen.
  subcontractor_id uuid references subcontractors(id) on delete set null,

  -- needs_matching | matched | dismissed
  state         text not null default 'needs_matching',

  matched_communication_id uuid references communications(id) on delete set null,
  matched_opportunity_id   uuid references opportunities(id) on delete set null,
  matched_by    text,
  matched_at    timestamptz,

  -- Required to dismiss. "Not ours" with no reason is indistinguishable from
  -- a message somebody could not be bothered to read.
  dismissed_reason text,
  dismissed_by  text,
  dismissed_at  timestamptz,

  created_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'unmatched_inbound_state_ck') then
    alter table unmatched_inbound add constraint unmatched_inbound_state_ck
      check (state in ('needs_matching','matched','dismissed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'unmatched_inbound_dismiss_ck') then
    alter table unmatched_inbound add constraint unmatched_inbound_dismiss_ck
      check (state <> 'dismissed' or coalesce(btrim(dismissed_reason), '') <> '');
  end if;
  -- Matched with nothing to point at is a state that means nothing.
  if not exists (select 1 from pg_constraint where conname = 'unmatched_inbound_matched_ck') then
    alter table unmatched_inbound add constraint unmatched_inbound_matched_ck
      check (state <> 'matched' or matched_opportunity_id is not null);
  end if;
end $$;

-- Idempotent polling. A mailbox poll that runs twice, or a poller that
-- restarts mid-batch, must not produce two rows for one message.
create unique index if not exists unmatched_inbound_message_idx
  on unmatched_inbound (org_id, message_id)
  where message_id is not null;

-- The inbox itself: what is still waiting, oldest first, because the oldest
-- unanswered message is the one most likely to have cost something.
create index if not exists unmatched_inbound_queue_idx
  on unmatched_inbound (org_id, received_at)
  where state = 'needs_matching';
