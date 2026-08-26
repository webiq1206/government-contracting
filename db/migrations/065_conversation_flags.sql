-- Per-conversation state that belongs to the operator, not to any one message.
--
-- Two questions the Communications centre has to answer and could not: has
-- anyone here looked at this conversation, and has anyone decided it is
-- finished. Neither is a property of a message. "Read" spans every message in
-- the thread, and a thread stays resolved when a new message arrives only if
-- somebody says so.
--
-- Thread-level rather than a `read_at` on every message: marking a thread read
-- is then one upsert instead of an update across every inbound row in it, and
-- the unread count is "inbound messages newer than read_at", which stays
-- correct without a backfill when a new message lands.
--
-- The key is the same one the centre groups by: the Gmail thread id where we
-- have one, and a synthetic key from the opportunity and subcontractor for
-- history that predates threading. It is text rather than a foreign key
-- because half of those values are not rows anywhere.

create table if not exists conversation_flags (
  org_id      uuid not null references organizations(id) on delete cascade,
  thread_key  text not null,
  -- When somebody last opened this conversation. Null means never opened.
  read_at     timestamptz,
  -- When somebody decided nothing further is needed. Cleared by reopening.
  resolved_at timestamptz,
  resolved_by uuid references users(id),
  updated_at  timestamptz not null default now(),
  primary key (org_id, thread_key)
);

-- The unresolved-thread sweep the header counts run over.
create index if not exists conversation_flags_open_idx
  on conversation_flags (org_id)
  where resolved_at is null;
