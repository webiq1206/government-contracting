-- A package that has been approved or sent is evidence, not a mutable draft.
-- Submission and outcome fields may continue through their own state machines,
-- but the price, requirements, files, validation and narrative that were
-- approved cannot be rewritten by a late worker or a direct SQL caller.

create or replace function public.lock_bid_artifacts_after_approval() returns trigger as $$
begin
  if (
       coalesce(old.submission_state, 'package_ready') <> 'package_ready'
       or coalesce(new.submission_state, 'package_ready') <> 'package_ready'
     ) and (
       new.sub_quote_total is distinct from old.sub_quote_total
    or new.markup_pct is distinct from old.markup_pct
    or new.bid_amount is distinct from old.bid_amount
    or new.margin_pct is distinct from old.margin_pct
    or new.target_margin_pct is distinct from old.target_margin_pct
    or new.qa_checklist is distinct from old.qa_checklist
    or new.narrative is distinct from old.narrative
    or new.documents_json is distinct from old.documents_json
    or new.human_flags is distinct from old.human_flags
    or new.compliance_matrix is distinct from old.compliance_matrix
    or new.package_manifest is distinct from old.package_manifest
    or new.package_ready is distinct from old.package_ready
    or new.validation_json is distinct from old.validation_json
    or new.audit_findings is distinct from old.audit_findings
    or new.audit_status is distinct from old.audit_status
    or new.requirements_fingerprint is distinct from old.requirements_fingerprint
  ) then
    raise exception 'approved and submitted bid artifacts are immutable';
  end if;
  return new;
end;
$$ language plpgsql set search_path = pg_catalog;

drop trigger if exists bids_lock_artifacts_after_approval on public.bids;
create trigger bids_lock_artifacts_after_approval
  before update on public.bids
  for each row execute function public.lock_bid_artifacts_after_approval();

-- Any price evidence arriving while the package is still a draft invalidates
-- its readiness in the same database statement. This closes the approval race
-- where a quote was saved just before the route cleared package_ready.
create or replace function public.invalidate_draft_bid_for_pricing_change() returns trigger as $$
declare
  opportunity uuid;
  organization uuid;
begin
  if tg_op = 'DELETE' then
    opportunity := old.opportunity_id;
    organization := old.org_id;
  else
    opportunity := new.opportunity_id;
    organization := new.org_id;
  end if;

  update public.bids
     set package_ready=false,
         audit_status='pending',
         human_flags=(
           select array(
             select distinct unnest(
               coalesce(human_flags, '{}'::text[]) || array['pricing_changed_rebuild_required']
             )
           )
         ),
         updated_at=now()
   where opportunity_id=opportunity
     and org_id=organization
     and submission_state='package_ready';

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$ language plpgsql set search_path = pg_catalog;

drop trigger if exists quotes_invalidate_draft_bid on public.quotes;
create trigger quotes_invalidate_draft_bid
  after insert or update or delete on public.quotes
  for each row execute function public.invalidate_draft_bid_for_pricing_change();

drop trigger if exists trade_pricing_invalidate_draft_bid on public.trade_pricing_rows;
create trigger trade_pricing_invalidate_draft_bid
  after insert or update or delete on public.trade_pricing_rows
  for each row execute function public.invalidate_draft_bid_for_pricing_change();

-- "Submitted" is a claim about delivery, so even a direct SQL caller must
-- have a sent bid and complete delivery evidence before moving the opportunity.
-- Once awaiting an outcome, the only forward paths are the two terminal
-- opportunity stages, backed by the bid outcome written in the same transaction.
create or replace function public.guard_opportunity_submission_lifecycle() returns trigger as $$
declare
  recorded_outcome text;
begin
  if new.stage = 'submitted' and old.stage is distinct from 'submitted' then
    if new.status is distinct from 'open' then
      raise exception 'a submitted opportunity must remain open while it awaits an agency outcome';
    end if;
    if not exists (
      select 1
        from public.bids b
       where b.opportunity_id = new.id
         and b.org_id = new.org_id
         and b.submission_state in ('sent', 'receipt_confirmed', 'accepted', 'rejected')
         and b.submitted_at is not null
         and b.submission_method is not null
         and coalesce(btrim(b.submission_destination), '') <> ''
         and b.sent_timezone is not null
         and b.submitted_package_hash ~ '^[A-Fa-f0-9]{64}$'
    ) then
      raise exception 'an opportunity needs confirmed bid delivery evidence before submission';
    end if;
  end if;

  if old.stage = 'submitted' and new.stage is distinct from old.stage then
    select b.outcome
      into recorded_outcome
      from public.bids b
     where b.opportunity_id = new.id and b.org_id = new.org_id
     order by b.created_at desc
     limit 1;
    if not (
      (new.stage = 'won' and new.status = 'closed' and recorded_outcome = 'won')
      or (new.stage = 'lost' and new.status = 'closed' and recorded_outcome in ('lost', 'no_award'))
    ) then
      raise exception 'a submitted opportunity can move only to its recorded agency outcome';
    end if;
  end if;

  if old.stage = 'submitted'
     and new.stage is not distinct from old.stage
     and new.status is distinct from old.status then
    raise exception 'a submitted opportunity remains open until its agency outcome is recorded';
  end if;

  if old.stage in ('won', 'lost')
     and (new.stage is distinct from old.stage or new.status is distinct from 'closed') then
    raise exception 'a terminal opportunity outcome cannot be reopened';
  end if;
  return new;
end;
$$ language plpgsql set search_path = pg_catalog;

drop trigger if exists opportunities_guard_submission_lifecycle on public.opportunities;
create trigger opportunities_guard_submission_lifecycle
  before update of stage, status on public.opportunities
  for each row execute function public.guard_opportunity_submission_lifecycle();

-- Trigger functions are migration infrastructure, not browser RPCs.
revoke all on function public.lock_bid_artifacts_after_approval() from public;
revoke all on function public.invalidate_draft_bid_for_pricing_change() from public;
revoke all on function public.guard_opportunity_submission_lifecycle() from public;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.lock_bid_artifacts_after_approval() from anon';
    execute 'revoke all on function public.invalidate_draft_bid_for_pricing_change() from anon';
    execute 'revoke all on function public.guard_opportunity_submission_lifecycle() from anon';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.lock_bid_artifacts_after_approval() from authenticated';
    execute 'revoke all on function public.invalidate_draft_bid_for_pricing_change() from authenticated';
    execute 'revoke all on function public.guard_opportunity_submission_lifecycle() from authenticated';
  end if;
end;
$$;
