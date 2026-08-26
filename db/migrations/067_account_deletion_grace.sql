-- A recoverable window before an account is destroyed.
--
-- Deleting an account removed the organization and every opportunity,
-- subcontractor, quote, document and message inside it, in one transaction,
-- the moment the button was pressed. The page said so honestly: "there is no
-- undo and no backup". That is a defensible thing to build and an indefensible
-- thing to leave as the only option, because the mistakes this guards against
-- are not misclicks (the name has to be typed) but decisions: the wrong
-- account of two similarly named ones, a cancellation the customer reverses a
-- day later, a support request somebody misread.
--
-- So a deletion becomes a scheduled one. The account is suspended immediately,
-- which stops all use and is the part the administrator actually wanted, and
-- the data is purged when the window runs out. Cancelling before then restores
-- everything, because nothing has been touched.
alter table organizations
  -- When the purge becomes due. Null means no deletion is scheduled, which is
  -- every account by default.
  add column if not exists deletion_scheduled_at timestamptz,
  -- Who asked and why, kept on the row as well as in the audit log so the
  -- account detail page can explain itself without a join.
  add column if not exists deletion_requested_by text,
  add column if not exists deletion_reason text,
  -- Separate from suspended_at on purpose. An account can be suspended for
  -- non-payment and not be scheduled for deletion, and restoring one of those
  -- must not silently cancel the other.
  add column if not exists deletion_requested_at timestamptz;

-- The sweep asks one question, so it gets one index for it.
create index if not exists organizations_deletion_due_idx
  on organizations (deletion_scheduled_at)
  where deletion_scheduled_at is not null;
