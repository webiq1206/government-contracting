-- The owner's own account: permanently entitled, administrable, multi-address.
--
-- Three separate problems, one migration, because they all describe the same
-- account and splitting them would leave the platform owner locked out between
-- two deploys.
--
-- 1. BILLING EXEMPTION
--
-- The organization that owns this platform had subscription_status 'canceled',
-- which made accessLevel() compute 'none' and locked the owner out of his own
-- product. users.role = 'admin' did not help, because role has never had
-- anything to do with entitlement.
--
-- The fix is an explicit column rather than a magic status value. A status of
-- 'comped' would have been fewer lines and much worse: every Stripe webhook
-- writes subscription_status, so the exemption would be silently erased the
-- first time Stripe said anything about the account. A separate column is
-- orthogonal to Stripe and survives.
--
-- 2. SUSPENSION
--
-- Distinct from cancellation. Cancelled is a billing state Stripe owns and a
-- payment reverses. Suspended is an administrative decision we own, it
-- outranks everything including the exemption, and only an admin lifts it.
--
-- 3. LOGIN ALIASES
--
-- users.email is UNIQUE, so additional sign-in addresses cannot be extra user
-- rows without splitting the account in two. A mapping table keeps one
-- account with several front doors.

-- ---------------------------------------------------------------------------
-- Billing exemption and suspension
-- ---------------------------------------------------------------------------

alter table organizations
  add column if not exists billing_exempt boolean not null default false,
  add column if not exists billing_exempt_reason text,
  add column if not exists billing_exempt_granted_by text,
  add column if not exists billing_exempt_granted_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspended_by text;

comment on column organizations.billing_exempt is
  'Full access regardless of subscription_status. Set for the platform owner and for comped accounts. Deliberately not a subscription_status value: Stripe webhooks overwrite that column.';
comment on column organizations.suspended_at is
  'Administrative suspension. Outranks billing_exempt. Data is retained; only access stops.';

-- Comp the organization owned by the platform owner. Matched by owner email
-- rather than by a hardcoded org id so this is correct in any environment,
-- and a no-op on a fresh install where that account does not exist yet.
update organizations o
   set billing_exempt = true,
       billing_exempt_reason = 'Platform owner account. This organization runs the product and is never billed for it.',
       billing_exempt_granted_by = 'migration 044',
       billing_exempt_granted_at = now()
 where exists (
   select 1
     from organization_members m
     join users u on u.id = m.user_id
    where m.org_id = o.id
      and m.role = 'owner'
      and lower(u.email) = 'brostcoholdings@gmail.com'
 );

-- ---------------------------------------------------------------------------
-- Login aliases
-- ---------------------------------------------------------------------------

create table if not exists user_email_aliases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

-- Addresses are compared lowercased everywhere, so uniqueness must be too.
create unique index if not exists user_email_aliases_email_uidx
  on user_email_aliases (lower(email));
create index if not exists user_email_aliases_user_idx
  on user_email_aliases (user_id);

-- Uniqueness has to span BOTH tables, or signup could claim an address that is
-- already somebody's alias and quietly steal their sign-in. Postgres has no
-- cross-table unique constraint, so this is a trigger on each side. The
-- application checks the same thing first for a friendly message; this is the
-- guarantee underneath it, and it holds against code paths that forget.
-- The rule is deliberately absolute: an address appears at most once across
-- both tables. No self-exclusion for the owning account either, because an
-- alias that merely repeats its own account's address is noise that shows up
-- in the admin view as "also signs in as <the address they already are>".
-- Promoting an alias to be the primary address means deleting the alias
-- first, which is one extra explicit step in a rare operation and worth it
-- for a rule with no exceptions to reason about.
create or replace function assert_login_email_unused() returns trigger as $$
begin
  -- Serialize on the address itself before looking. Two transactions
  -- inserting the same address into the two different tables would otherwise
  -- each see no committed conflict and both commit, leaving one address that
  -- signs in to two accounts. Taking the lock first makes the check mean
  -- something under concurrency; it is released with the transaction.
  perform pg_advisory_xact_lock(hashtext(lower(new.email)));

  if tg_table_name = 'users' then
    if exists (
      select 1 from user_email_aliases a where lower(a.email) = lower(new.email)
    ) then
      raise exception 'Email % is already a login alias', new.email
        using errcode = '23505';
    end if;
  else
    if exists (
      select 1 from users u where lower(u.email) = lower(new.email)
    ) then
      raise exception 'Email % is already a user account', new.email
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_email_unused on users;
create trigger users_email_unused
  before insert or update of email on users
  for each row execute function assert_login_email_unused();

drop trigger if exists aliases_email_unused on user_email_aliases;
create trigger aliases_email_unused
  before insert or update of email on user_email_aliases
  for each row execute function assert_login_email_unused();

-- The owner's working addresses. Mail to the business goes to these; until now
-- neither could sign in.
-- Refuse to apply rather than half-apply.
--
-- If either address already exists as its own user account, the trigger above
-- raises and this insert cannot proceed. Skipping the address quietly would be
-- worse than failing: the migration would record as applied, and the owner
-- would simply find that one of his two addresses does not sign in, with
-- nothing anywhere to say why. Stopping here with an actionable message means
-- somebody decides deliberately what happens to the conflicting account.
do $$
declare conflicting text;
begin
  select string_agg(u.email, ', ') into conflicting
    from users u
   where lower(u.email) in ('info@brostco.com', 'hello@brostco.com');

  if conflicting is not null then
    raise exception
      'Cannot add owner login aliases: % already exists as a separate user account. Decide what happens to it (delete it, or move its data to brostcoholdings@gmail.com), then re-run this migration.',
      conflicting;
  end if;
end $$;

insert into user_email_aliases (user_id, email)
select u.id, a.email
  from users u
  cross join (values ('info@brostco.com'), ('hello@brostco.com')) as a(email)
 where lower(u.email) = 'brostcoholdings@gmail.com'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Impersonation ("sign in as a customer")
-- ---------------------------------------------------------------------------
--
-- An impersonated session is a real session row for the target user, marked
-- with who opened it. Storing the admin's own session id lets "return to
-- admin" restore the original session instead of forcing a re-login, and
-- means the marker travels with the session rather than with a cookie the
-- browser could drop.

alter table sessions
  add column if not exists impersonator_user_id    uuid references users(id) on delete cascade,
  add column if not exists impersonator_email      text,
  add column if not exists impersonator_session_id text;

create index if not exists sessions_impersonator_idx
  on sessions (impersonator_user_id) where impersonator_user_id is not null;

-- ---------------------------------------------------------------------------
-- Admin audit trail
-- ---------------------------------------------------------------------------
--
-- Every cross-tenant action an admin takes. Append-only by convention: there
-- is no update path in the application. Kept even when the target org is
-- deleted, which is exactly when the record matters most, so the org id is a
-- plain column rather than a foreign key.

create table if not exists admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  admin_email    text not null,
  action         text not null,
  target_org_id  uuid,
  target_org_name text,
  target_user_id uuid,
  detail         jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_org_idx on admin_audit_log (target_org_id);

-- ---------------------------------------------------------------------------
-- Retire the stale admin@brostco.dev account
-- ---------------------------------------------------------------------------
--
-- It co-owns the founding organization with the real owner account and is not
-- used. Two of its references (influencer_payouts.approved_by,
-- subcontractor_documents.verified_by) are ON DELETE NO ACTION, so they are
-- reassigned rather than left to block the delete; analytics_events would go
-- to NULL and is reassigned too so historical attribution survives.
--
-- Guarded on the real owner existing, so this can never remove the last owner
-- of the founding organization.

do $$
declare
  owner_id uuid;
  stale_id uuid;
begin
  select id into owner_id from users where lower(email) = 'brostcoholdings@gmail.com';
  select id into stale_id from users where lower(email) = 'admin@brostco.dev';

  if owner_id is null or stale_id is null then
    return;
  end if;

  -- The founding org must still have an owner afterwards.
  if not exists (
    select 1 from organization_members
     where user_id = owner_id and role = 'owner'
  ) then
    raise notice 'Skipping stale account removal: owner account has no owner membership.';
    return;
  end if;

  update analytics_events        set user_id     = owner_id where user_id     = stale_id;
  update influencer_payouts      set approved_by = owner_id where approved_by = stale_id;
  update subcontractor_documents set verified_by = owner_id where verified_by = stale_id;

  -- sessions, organization_members and password_reset_tokens all cascade.
  delete from users where id = stale_id;
end;
$$;
