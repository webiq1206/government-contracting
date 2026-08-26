-- Connected sessions, so a person can see where they are signed in.
--
-- A session row carried a token, a user and two timestamps. That is enough to
-- authenticate and not enough to answer the question somebody asks when they
-- think their account has been used: which devices are signed in, and when did
-- each of them last do anything. Without an answer, the only safe move on
-- suspicion is a password reset, which signs out every device including the
-- ones they wanted to keep.
--
-- Deliberately no IP address. It would add a rough location and a durable
-- identifier for every request, and the question here is "is that my laptop",
-- which the user agent answers without keeping a log of where somebody works.
alter table sessions
  add column if not exists user_agent   text,
  -- Touched at most once every few minutes rather than on every request: this
  -- is for recognising a session, not for accounting.
  add column if not exists last_seen_at timestamptz;

-- Existing sessions have no user agent and no last-seen. Left null on purpose
-- so the interface can say "not recorded" rather than invent a device or
-- backfill last_seen_at with a time nothing happened at.
