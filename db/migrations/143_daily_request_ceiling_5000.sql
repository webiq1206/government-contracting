-- Production stopped paid AI at api_account_budgets.daily_requests = 1000
-- ("You reached today's request limit of 1000"). Raise that request ceiling
-- to 5000. Monthly dollar limits are left exactly as stored, including $1000.
update api_account_budgets
   set daily_requests = 5000,
       updated_at = now()
 where daily_requests = 1000;

-- The shared platform request allowance was seeded at 1000. A code default of
-- 5000 does not apply while this row exists, so raise the stored count too.
-- monthly_limit is not part of this update.
update api_usage_limits
   set daily_requests = 5000,
       updated_at = now()
 where daily_requests = 1000
   and org_id is null
   and provider = '*'
   and feature = '*';
