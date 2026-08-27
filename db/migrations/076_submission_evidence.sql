-- What "submitted" is allowed to mean.
--
-- The submit endpoint ran `update bids set submitted_at=now(), outcome='pending'`
-- and that was the whole ceremony. Nothing recorded how the package reached
-- the agency, when, to what address, or whether anybody on the other end
-- acknowledged it.
--
-- That matters because for almost every solicitation this product handles,
-- Brost Co does not submit anything. A person opens a government portal,
-- uploads the files themselves, and comes back. The button said "Submit bid
-- package", the timestamp said submitted, and the only thing that had actually
-- happened was somebody pressing a button in a different application.
--
-- A bid recorded as submitted with no evidence is worse than one recorded as
-- ready, because the first stops anybody checking.

alter table bids
  -- package_ready | approved | sending | sent | receipt_confirmed | accepted
  -- | rejected | withdrawn | failed
  add column if not exists submission_state text not null default 'package_ready',

  -- portal | email | connector | mail | hand
  add column if not exists submission_method text,
  add column if not exists submission_destination text,
  -- The timezone the send time was read in. A deadline argument turns on which
  -- clock somebody was looking at, and "14:02" without one is not evidence.
  add column if not exists sent_timezone text,
  add column if not exists confirmation_number text,
  -- The receipt, the screenshot, the confirmation email: a stored document.
  add column if not exists proof_document_id uuid references documents(id) on delete set null,
  -- The operator saying in their own words what they did. Not a checkbox: a
  -- checkbox records that somebody clicked, a sentence records what they saw.
  add column if not exists submission_attestation text,
  add column if not exists submitted_by text,
  -- Which version of the package actually went. Without it, a package rebuilt
  -- after an amendment is indistinguishable from the one that was uploaded.
  add column if not exists submitted_package_hash text,

  -- The other end.
  add column if not exists receipt_confirmed_at timestamptz,
  add column if not exists receipt_detail text,
  add column if not exists rejected_reason text,
  add column if not exists withdrawn_reason text,

  -- Connector sends only: what was actually exchanged.
  add column if not exists provider_request_id text,
  add column if not exists provider_response text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bids_submission_state_ck') then
    alter table bids add constraint bids_submission_state_ck
      check (submission_state in ('package_ready','approved','sending','sent',
                                  'receipt_confirmed','accepted','rejected',
                                  'withdrawn','failed'));
  end if;
  /*
   * The rule the whole migration exists for: `submitted_at` may not be set
   * without a send time, a method and a destination.
   *
   * A constraint rather than a check in the endpoint, because the endpoint is
   * one caller and this is a claim about the world. Anything that wants to
   * write "this bid was submitted" has to be able to say how.
   */
  if not exists (select 1 from pg_constraint where conname = 'bids_submitted_evidence_ck') then
    alter table bids add constraint bids_submitted_evidence_ck
      check (
        submitted_at is null
        or (submission_method is not null
            and coalesce(btrim(submission_destination), '') <> ''
            and sent_timezone is not null)
      );
  end if;
  -- Accepted and rejected are claims about the agency's decision, so each
  -- needs the thing that carries it.
  if not exists (select 1 from pg_constraint where conname = 'bids_rejected_reason_ck') then
    alter table bids add constraint bids_rejected_reason_ck
      check (submission_state <> 'rejected' or coalesce(btrim(rejected_reason), '') <> '');
  end if;
end $$;

-- "Which bids are sent and still unacknowledged" is the query that catches the
-- state that quietly loses bids.
create index if not exists bids_awaiting_receipt_idx
  on bids (org_id, submitted_at)
  where submission_state = 'sent';

-- ---------------------------------------------------------------------------
-- Every change of submission state, with who made it and what it rested on.
--
-- Separate from the bid because the bid holds where things stand and this
-- holds how they got there. "Sent, rejected, corrected, sent again" and "sent"
-- are different stories about the same final row, and only one of them
-- explains a second confirmation number.
-- ---------------------------------------------------------------------------
create table if not exists bid_submission_events (
  id           uuid primary key default gen_random_uuid(),
  bid_id       uuid not null references bids(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  from_state   text,
  to_state     text not null,
  actor        text not null,
  -- What was proven at that moment, in words. Not the state name.
  proof        text,
  created_at   timestamptz not null default now()
);
create index if not exists bid_submission_events_bid_idx
  on bid_submission_events (bid_id, created_at);
