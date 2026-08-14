-- Did the terms actually land on the account?
--
-- Accepting an invitation is three things in a row: claim the link, create the
-- account, then write the promised terms onto it. The first two are atomic
-- individually and the third is a separate statement, so there is a window
-- where somebody has an account but not the deal they were promised.
--
-- Treating that as impossible is how it goes unnoticed. Instead it is
-- recorded: an invitation that was accepted but whose terms never landed is
-- visible on the admin list, and can be put right by granting the concession
-- from the account page. Silence would mean the customer discovering it on an
-- invoice instead.
alter table account_invitations
  add column if not exists terms_applied_at timestamptz;

comment on column account_invitations.terms_applied_at is
  'Set once the promised plan and concession are written to the accepted organization. Accepted with this still null means the account exists on standard terms and needs the concession applying by hand.';
