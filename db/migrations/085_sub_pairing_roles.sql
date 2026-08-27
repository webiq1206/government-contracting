-- Which subcontractor is actually the one, and what happened to the others.
--
-- opportunity_subs recorded that a firm had been paired with a trade on a bid
-- and nothing about the decisions an operator makes afterwards. There was no
-- way to say "this one is who we are pricing and that one is the fallback",
-- and no way to take a firm off a bid except to delete the row, which takes
-- the outreach history with it: the emails sent, the replies received, and the
-- reason somebody decided to stop.
--
-- Three additions, and the third is the one that matters most.

-- 1. Which of the candidates in a trade is the one being priced.
--    Null is undecided, and undecided is the honest default: nobody has picked
--    yet is a different state from picked-and-it-is-this-one.
alter table opportunity_subs
  add column if not exists role text
    check (role is null or role in ('primary', 'backup'));

-- 2. Off the bid, with the reason, rather than deleted.
--    A removed pairing keeps every email, reply and call attached to it. The
--    alternative loses the record of who was approached, which is exactly what
--    somebody asks for when a bid goes wrong.
alter table opportunity_subs
  add column if not exists removed_at timestamptz;
alter table opportunity_subs
  add column if not exists removed_reason text;
alter table opportunity_subs
  add column if not exists removed_by uuid references users(id) on delete set null;

-- 3. When one firm replaced another, which one.
--    Not merely "removed": a replacement is a chain, and reading it backwards
--    is how somebody works out that this trade has burned through four
--    subcontractors and none of them quoted.
alter table opportunity_subs
  add column if not exists replaced_by uuid references opportunity_subs(id) on delete set null;

-- A removal must say why. A row that says a firm was taken off the bid and
-- cannot say what for is a row that tells the next person nothing, and the
-- next person here is whoever has to explain the bid.
alter table opportunity_subs
  drop constraint if exists opportunity_subs_removal_reason_ck;
alter table opportunity_subs
  add constraint opportunity_subs_removal_reason_ck check (
    removed_at is null or coalesce(btrim(removed_reason), '') <> ''
  );

-- One primary per trade, enforced rather than intended.
--
-- Two primaries in a trade is not a display problem: the pricing workspace
-- reads the primary to build the bid, and two of them means whichever the
-- query happens to return first. Partial, so removed rows do not hold the slot
-- against the firm that replaced them.
create unique index if not exists opportunity_subs_one_primary_idx
  on opportunity_subs (opportunity_id, coalesce(trade, ''))
  where role = 'primary' and removed_at is null;

create index if not exists opportunity_subs_active_idx
  on opportunity_subs (opportunity_id) where removed_at is null;
