-- Send-tracking + follow-up columns for backlink outreach. Outreach is only ever
-- sent after a human approves it (approval_status = 'approved'); these columns
-- record the actual send and drive one polite follow-up.
alter table backlink_outreach
  add column if not exists gmail_message_id text,
  add column if not exists gmail_thread_id  text,
  add column if not exists tracking_id      text,
  add column if not exists follow_up_at      timestamptz,
  add column if not exists follow_up_sent    boolean not null default false,
  add column if not exists send_error        text;

create index if not exists backlink_outreach_send_idx
  on backlink_outreach (approval_status, sent_at);
