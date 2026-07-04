-- ============================================================================
-- Migration 0002 — Row-Level Security lockdown (Supabase hardening)
--
-- The BROSTCO server connects to Postgres via the direct DATABASE_URL role,
-- which OWNS these tables and therefore BYPASSES RLS — the app is unaffected.
-- What this migration does is lock down Supabase's auto-generated PostgREST API:
-- enabling RLS with no permissive policies means the `anon` and `authenticated`
-- API roles can read/write NOTHING. Combined with revoking their table grants,
-- no application table is reachable through the public Supabase REST/JS client.
--
-- (We intentionally do NOT `FORCE` RLS — forcing it would also subject the table
-- owner our server connects as, which would lock the application out.)
--
-- Safe on plain Postgres too: the anon/authenticated roles simply may not exist,
-- and the grants are only revoked when the role is present.
-- ============================================================================

do $$
declare
  t text;
  app_tables text[] := array[
    'company_profile','scoring_weights','opportunities','subcontractors',
    'opportunity_subs','quotes','pricing_comps','bids','contracts',
    'communications','documents','templates','compliance_items','agent_logs',
    'call_cards','users','sessions','integration_tokens','job_runs','_migrations'
  ];
  has_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
  has_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array app_tables loop
    -- Skip anything that doesn't exist yet (defensive).
    if not exists (select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = t) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security;', t);

    -- Belt-and-suspenders: remove any default privileges granted to the public
    -- API roles. With RLS on and no policy, access is already denied; revoking
    -- grants makes the intent explicit and defends against future policy edits.
    if has_anon then
      execute format('revoke all on table public.%I from anon;', t);
    end if;
    if has_auth then
      execute format('revoke all on table public.%I from authenticated;', t);
    end if;
  end loop;
end $$;

-- NOTE for future maintainers:
-- The Supabase `service_role` has the BYPASSRLS attribute and is what the
-- SUPABASE_SERVICE_ROLE_KEY uses (Storage + any admin ops) — it is intentionally
-- unrestricted and unaffected by the above. If you ever want to expose a table
-- to the browser via PostgREST, add explicit `create policy ...` statements here
-- scoped to `authenticated` with an appropriate `using`/`with check` clause.
