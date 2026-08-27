-- Somewhere to say the product is wrong.
--
-- There was no route for it. A customer who found a number that did not add
-- up, or wanted a report the product does not have, had one option: email an
-- address printed on the billing page and hope. That is a support channel for
-- billing, not a feedback channel for the product, and the difference shows in
-- what never arrived.
--
-- What is stored is deliberately narrow. The page, the account, the person,
-- what kind of problem it is, and what they wrote. Anything beyond that is
-- diagnostic context the sender has to agree to attach, and the form says
-- exactly what is in it before they do. No credentials, no record contents,
-- and no query strings: a path says which screen somebody was on, and a query
-- string can carry what they were searching for.

create table if not exists feedback_reports (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  -- Nulled rather than cascaded when an account is removed. The report is
  -- still true and still worth acting on; who sent it stops being the point.
  user_id        uuid references users(id) on delete set null,
  -- Kept alongside the id so a report from somebody who has since left still
  -- says who it was from.
  user_email     text,
  category       text not null,
  message        text not null,
  -- The path only. Never the query string.
  page           text,
  -- The browser's own description of itself, which is the difference between
  -- a bug report somebody can reproduce and one they cannot.
  browser        text,
  /*
   * Everything else about the session, and only when the sender said yes.
   *
   * A jsonb blob rather than columns because the useful contents change with
   * whatever is being investigated, and because a column nobody fills is a
   * question the form has to keep asking.
   */
  diagnostics    jsonb,
  diagnostics_consented boolean not null default false,
  -- An optional screenshot, stored like every other tenant file so the same
  -- ownership resolver governs who can read it.
  storage_path   text,
  screenshot_name text,
  status         text not null default 'new',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_reports_category_ck') then
    alter table feedback_reports add constraint feedback_reports_category_ck
      check (category in ('bug', 'wrong_number', 'confusing', 'feature', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_reports_status_ck') then
    alter table feedback_reports add constraint feedback_reports_status_ck
      check (status in ('new', 'read', 'actioned', 'declined'));
  end if;
  /*
   * Diagnostics cannot exist without consent.
   *
   * Enforced here rather than trusted to the writer. The whole promise of the
   * checkbox is that unticking it means nothing extra is kept, and a promise
   * that depends on every future code path remembering is not one.
   */
  if not exists (select 1 from pg_constraint where conname = 'feedback_reports_consent_ck') then
    alter table feedback_reports add constraint feedback_reports_consent_ck
      check (diagnostics is null or diagnostics_consented = true);
  end if;
end $$;

create index if not exists feedback_reports_org_idx
  on feedback_reports (org_id, created_at desc);
