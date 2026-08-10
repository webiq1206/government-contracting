-- Outreach can now send via Resend when Gmail is not connected. Track which
-- provider carried each email so replies/threading and debugging stay clear.
-- Legacy rows (null) were all Gmail. The gmail_message_id column holds the
-- provider's message id for either provider (Resend has no thread id).
alter table communications add column if not exists provider text;
