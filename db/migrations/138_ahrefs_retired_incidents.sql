-- Ahrefs can be turned off without calling it recovered.
--
-- `recovered` means a provider test passed and the work was confirmed.
-- Turning the integration off is a different fact: no request was sent and
-- failed backlink work was not replayed. `retired` is that closed state.
--
-- No rows are deleted. The state check gains one allowed value, and the
-- one-open-incident index treats `retired` the same way it already treats
-- `recovered`, so a later outage of the same cause from another provider
-- can still be recorded.

alter table automation_incidents drop constraint if exists automation_incidents_state_ck;
alter table automation_incidents add constraint automation_incidents_state_ck
  check (state in (
    'detected', 'mitigating', 'provider_restored', 'test_passed',
    'backlog_requeued', 'backlog_draining', 'recovered', 'recovery_failed',
    'retired'
  ));

drop index if exists automation_incidents_open_idx;
create unique index automation_incidents_open_idx
  on automation_incidents (org_id, cause)
  where state not in ('recovered', 'retired');
