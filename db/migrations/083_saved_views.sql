-- Saved views, and who can see them.
--
-- They lived in localStorage. That was the right call for one of the two kinds
-- and the wrong one for the other, and the comment in the toolbar said as much:
-- putting every view on the server would mean one operator's "Due this week"
-- appearing in a colleague's toolbar uninvited.
--
-- The answer is not to pick a side but to say which kind each view is. A
-- personal view is somebody's own shortcut and belongs to them; a team view is
-- how an office agrees on what "the work" means this month, and it is useless
-- if it exists only in the browser of the person who made it. Both are stored
-- here and the scope column decides who sees which.
--
-- Moving personal views here as well costs nothing and buys something: a
-- device change no longer loses them, which is the failure that made saved
-- views feel unreliable and stopped people making any.
--
-- What stays in the browser is the last view somebody left, which is a
-- per-device convenience rather than a thing anybody named.

create table if not exists saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Which list this belongs to: "opportunities", "subs", "admin.accounts".
  page_key text not null,
  name text not null,
  -- The query string, and nothing else. A view can only ever be something the
  -- page can already render, which is what stops a saved view from becoming a
  -- second, weaker query language.
  query text not null,
  scope text not null check (scope in ('personal', 'team')),
  -- Kept even when the person leaves: a team view outlives its author, and the
  -- alternative is an office losing its shared filters when somebody resigns.
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A personal view has to know whose it is, and a team view must not pretend
  -- to. Null owner on a personal view would make it visible to nobody, which
  -- is worse than not saving it.
  owner_id uuid references users(id) on delete cascade,
  check (scope = 'team' or owner_id is not null)
);

-- One team view per name per list. Two views called "Due this week" showing
-- different things is how a shared filter stops being shared.
create unique index if not exists saved_views_team_name_idx
  on saved_views (org_id, page_key, lower(name))
  where scope = 'team';

-- And one personal view per name per person per list.
create unique index if not exists saved_views_personal_name_idx
  on saved_views (org_id, owner_id, page_key, lower(name))
  where scope = 'personal';

create index if not exists saved_views_lookup_idx
  on saved_views (org_id, page_key);
