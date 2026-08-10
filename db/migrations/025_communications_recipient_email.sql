-- Store the exact email address used when sending outreach so the Email Log
-- always shows who was contacted, even if the sub's record is later updated.
ALTER TABLE communications ADD COLUMN IF NOT EXISTS recipient_email text;
