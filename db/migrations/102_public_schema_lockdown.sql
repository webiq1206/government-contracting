-- Close every public application table that was added after the original RLS
-- sweeps but did not receive the same Supabase/PostgREST lockdown.
--
-- The application server connects as the table owner. RLS is enabled without
-- permissive policies, so public API roles cannot read or write these tables
-- while the server owner continues to bypass RLS. Do not FORCE RLS here: that
-- would apply the empty policy set to the server owner and stop the platform.

do $$
declare
  t text;
  app_tables text[] := array[
    'integration_settings',
    'subcontractor_reply_events',
    'stripe_events',
    'influencers',
    'influencer_codes',
    'referral_attributions',
    'commission_events',
    'influencer_payouts',
    'subcontractor_documents',
    'subcontractor_payments',
    'user_email_aliases',
    'admin_audit_log',
    'reply_drafts',
    'account_invitations',
    'platform_key_grants',
    'platform_key_usage',
    'sam_daily_calls',
    'email_suppressions',
    'conversation_flags',
    'automation_incidents',
    'incident_events',
    'incident_requeues',
    'unmatched_inbound',
    'bid_submission_events',
    'bid_overrides',
    'trade_pricing_rows',
    'bid_calculation_snapshots',
    'outreach_suppressions',
    'solicitation_verifications',
    'saved_views',
    'requirement_states',
    'requirement_state_events',
    'subcontractor_performance_events',
    'subcontractor_merges',
    'subcontractor_contacts',
    'subcontractor_licenses',
    'subcontractor_tags',
    'subcontractor_bulk_actions',
    'compliance_item_events',
    'contract_milestones',
    'contract_modifications',
    'contract_invoices',
    'contract_issues',
    'contract_coordination',
    'compliance_item_documents',
    'billing_invoices',
    'feedback_reports'
  ];
  has_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
  has_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array app_tables loop
    if not exists (
      select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = t
         and c.relkind in ('r', 'p')
    ) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if has_anon then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if has_auth then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
  end loop;
end
$$;

-- Future tables and sequences created by this migration role start closed.
-- A future browser-facing feature must opt in with an explicit, tenant-scoped
-- policy and grant rather than inheriting access accidentally.
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from authenticated';
  end if;
end
$$;
