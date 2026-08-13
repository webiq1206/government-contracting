-- Ordering for autosaved edits to a suggested reply.
--
-- The browser debounces edits and writes them in the background. Those writes
-- can arrive out of order: an earlier one that stalled on a slow connection
-- can land after a later one, and the operator's newest sentence is silently
-- replaced by an older version of itself. Queueing the requests on the client
-- covers most of it, but not the case that matters most, which is the page
-- being closed: the last edit has to be fired off with keepalive, outside any
-- queue, precisely because there is no page left to wait on.
--
-- So ordering is settled here instead, where arrival order does not matter. An
-- edit carries the revision it produces, and an update only wins if it is
-- newer than what is already stored. A stale write becomes a no-op rather than
-- a data loss.
alter table reply_drafts
  add column if not exists rev bigint not null default 0;
