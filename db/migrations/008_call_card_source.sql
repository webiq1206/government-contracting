-- Call cards can now originate two ways:
--   'reply'    - the sub replied to outreach (warm; existing behavior)
--   'outreach' - we emailed the sub, so they become a call card to follow up by
--                phone whether or not they ever reply.
-- Existing cards were all reply-driven, so 'reply' is the correct default.
alter table call_cards
  add column if not exists source text not null default 'reply';

create index if not exists call_cards_source_idx on call_cards (source);
