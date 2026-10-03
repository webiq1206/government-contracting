-- Durable claims survive process/connection loss; no automatic expiry or takeover.
-- The guard holds a connection only for claim and settlement, never provider I/O.
alter table ai_provider_facts
  add column pending_attempt uuid,
  add column pending_started_at timestamptz,
  add constraint ai_provider_attempt_pair check
    ((pending_attempt is null) = (pending_started_at is null));
