-- Adopt the rows this audit's fixes left stranded, and stop agent_logs
-- producing more of them.
--
-- 042 made a child row's org self-maintaining and repaired the orphans that
-- existed then. It could not cover two cases, and both turned out to matter:
--
--   agent_logs      never had a derive trigger, and logAgent never set org_id,
--                   so EVERY log line on the platform carried a null org. The
--                   Automation Log page reads `where org_id = $1`, so the audit
--                   backbone was writing to a table no customer could read
--                   from. The writer now sets it; this adopts the history.
--
--   scoring_weights is a root table with no parent to derive from, and the
--                   Learning Loop wrote its proposals with no org at all. The
--                   approval screen reads by org, so a customer could never see
--                   or approve the rubric change proposed for them.
--
-- Nothing here deletes. A row whose owner can be established is given to that
-- owner; a row whose owner cannot be is given to the founding organization,
-- which is the same call 042 made and the safe direction: an unattributable
-- line becomes visible to the operator, never to a customer it may not belong
-- to.

-- ---------------------------------------------------------------------------
-- 1. agent_logs: the opportunity decides, then the subcontractor.
-- ---------------------------------------------------------------------------

update agent_logs l set org_id = o.org_id
  from opportunities o
 where l.opportunity_id = o.id and l.org_id is null and o.org_id is not null;

update agent_logs l set org_id = s.org_id
  from subcontractors s
 where l.subcontractor_id = s.id and l.org_id is null and s.org_id is not null;

update agent_logs l set org_id = b.org_id
  from bids b
 where l.bid_id = b.id and l.org_id is null and b.org_id is not null;

-- What is left names no record: platform-level cron lines, and per-tenant work
-- from before the writer set the column. Neither can be attributed now.
update agent_logs
   set org_id = '00000000-0000-4000-8000-000000000001'::uuid
 where org_id is null;

-- ---------------------------------------------------------------------------
-- 2. scoring_weights: a root table, so the founding org is the only answer.
-- ---------------------------------------------------------------------------
--
-- Safe against the per-org active uniqueness from 043: an orphaned row is a
-- Learning Loop proposal, which is always written inactive and awaiting
-- approval, so adopting it cannot collide with the founding org's active
-- version. The guard is explicit rather than assumed.

update scoring_weights
   set org_id = '00000000-0000-4000-8000-000000000001'::uuid
 where org_id is null
   and not is_active;

-- ---------------------------------------------------------------------------
-- 3. Prevention: give agent_logs the same derive trigger as every other child.
-- ---------------------------------------------------------------------------
--
-- The writer sets org_id now, but 042's lesson was that a self-maintaining
-- column outlives whoever remembers to set it. A log line about one record
-- belongs to that record's organization, and the trigger only fills nulls, so
-- the writer's own value always wins.

create or replace function derive_org_for_agent_log() returns trigger as $$
begin
  if new.org_id is null and new.opportunity_id is not null then
    select org_id into new.org_id from opportunities where id = new.opportunity_id;
  end if;
  if new.org_id is null and new.subcontractor_id is not null then
    select org_id into new.org_id from subcontractors where id = new.subcontractor_id;
  end if;
  if new.org_id is null and new.bid_id is not null then
    select org_id into new.org_id from bids where id = new.bid_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists agent_logs_derive_org on agent_logs;
create trigger agent_logs_derive_org
  before insert on agent_logs
  for each row execute function derive_org_for_agent_log();
