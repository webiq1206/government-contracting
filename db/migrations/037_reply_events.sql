-- Subcontractor reply history and per-solicitation availability outcomes.
--
-- Two things this fixes.
--
-- 1. A reply outcome was only ever an append to subcontractors.notes, which is
--    free text: unqueryable, unauditable, and impossible to show as history.
--    Every understood reply now becomes a row here, carrying the reason, the
--    date, the solicitation it was about, and the original message.
--
-- 2. "Declined", "unavailable for this one", and "not a fit for this scope"
--    were collapsed into a single declined state. They mean different things
--    for future work: a sub who is merely booked this month must still be
--    offered the next job.

create table if not exists subcontractor_reply_events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references organizations(id) on delete cascade,
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,
  -- Always recorded. An outcome without the solicitation it applies to is what
  -- caused subs to be written off globally in the first place.
  opportunity_id   uuid references opportunities(id) on delete cascade,
  trade            text,
  -- quote | interested | decline | unavailable | cant_fulfill | question | other
  intent           text not null,
  -- Plain-English reason in the sub's own terms, for the history view.
  reason           text,
  -- The message as received, so a human can always check our reading of it.
  original_message text,
  gmail_message_id text,
  gmail_thread_id  text,
  -- Full structured extraction, kept even when confidence was too low to act.
  extracted        jsonb not null default '{}'::jsonb,
  confidence       numeric(3,2) not null default 0,
  /**
   * True when the platform deliberately did not act: low confidence, or the
   * reply contradicted itself. Surfaces in the review queue instead of
   * silently changing a bid.
   */
  needs_review     boolean not null default false,
  review_reason    text,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists sub_reply_events_sub_idx
  on subcontractor_reply_events (subcontractor_id, created_at desc);
create index if not exists sub_reply_events_opp_idx
  on subcontractor_reply_events (opportunity_id);
create index if not exists sub_reply_events_review_idx
  on subcontractor_reply_events (needs_review)
  where needs_review and reviewed_at is null;

-- One event per inbound message, so a re-poll of the sliding window cannot
-- write the same reply into a sub's history twice.
create unique index if not exists sub_reply_events_message_uniq
  on subcontractor_reply_events (gmail_message_id)
  where gmail_message_id is not null;
