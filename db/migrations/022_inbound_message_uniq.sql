-- Inbound replies must be idempotent: webhook providers (Resend/svix) retry
-- deliveries, and the Gmail poller re-scans a sliding window. Enforce one
-- inbound communication per provider message id at the database level.
-- Dedupe first, keeping the earliest row.
delete from communications c
 using communications older
 where c.direction = 'inbound'
   and older.direction = 'inbound'
   and c.gmail_message_id is not null
   and c.gmail_message_id = older.gmail_message_id
   and (older.created_at, older.id) < (c.created_at, c.id);

create unique index if not exists communications_inbound_message_uniq
  on communications (gmail_message_id)
  where direction = 'inbound' and gmail_message_id is not null;
