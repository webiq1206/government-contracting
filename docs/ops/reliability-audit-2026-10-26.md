# Reliability audit, 2026-10-26

Live site: https://brostco.com. This record is from the repository at the time of the fix. It is not a claim that production was rechecked after the outage.

## Root cause of the repeated outage

Confirmed in code, and consistent with the production symptoms (edge `A` 34.111.179.208 returned 0 bytes for `brostco.com` while `webiq.co` on the same address stayed HTTP 200; Repl still said Live; hangs followed a Today reply-card save while the account was at its daily request cap; logs showed `ApiUsageBlockedError` around 14:15 MT and `MissingTenantContextError` from `app/(dash)/today/page.js` around 14:21 MT; the worker went quiet after about 14:24).

`beginUsage` took a global Postgres advisory lock, `pg_advisory_xact_lock(hashtext('api-usage-admission'))`, and then counted `api_usage_events` before it could refuse the call. Once `api_account_budgets.daily_requests` was already 1000 of 1000, every paid call still waited on that lock while holding a pool connection. The web pool is small (default 10) and the statement timeout is 15 seconds on the web process, 120 seconds on the worker. Today renders many queries at once, reply saves navigate and refresh the whole page, and `TodayLive` refreshed again whenever a tab became visible. Enough of those waiters filled the pool. New requests then sat until the process stopped writing bytes. Republish killed the waiters, which is why the site came back and then died the same way. DNS was not the failure: another host on the same edge address kept answering.

The error text was the account row, not the monthly dollar budget and not `DEFAULT_PLATFORM_REQUESTS` by itself: `You reached today's request limit of 1000`. `DEFAULT_ACCOUNT_BUDGET.daily_requests` in code is still 100. The live row in `api_account_budgets` had been raised to 1000, and migration 116 also seeded a global `api_usage_limits` row at `daily_requests` 1000. That stored platform row is what `DEFAULT_PLATFORM_REQUESTS` falls back from, so raising only the constant would not move an existing database. Both 1000 ceilings are raised to 5000. Monthly spend was still under the $1000 monthly cap. Unconfirmed costs were not the stop. The platform constant is a second ceiling for non-tenant credentials. It did not produce the "limit of 1000" sentence the operator saw.

`MissingTenantContextError` is thrown by `resolveTenantOrgId` when there is no job org and `currentUser()` is missing or has no organization. The dashboard layout redirects that case, but the Today page can render beside the layout. On `main`, Today called `getAutomationRules`, `actionCenter`, `getActiveProfile`, `getAutomationState`, and `dailyDigest` without catching that error, and the reply review handler called `resolveTenantOrgId()` with no catch (that is `app/api/replies/[id]/review/route.ts` around line 104 on `main`; this tree has no separate replies preview route). A missing tenant therefore failed the request. It is a separate defect from the lock. It did not, by itself, explain a 0-byte timeout of the whole host. Containing it matters so a tenant miss cannot restamp Today through the error page and add more load while the pool is already full. Binding the organization after the session is known stops a later cookie failure from looking like a missing tenant.

What this repository cannot prove: the live Replit process after 14:24, the published tip versus `origin/main`, or that the edge is healthy now. Kai's republish is still required for the current dead process. This change stops the next stampede from pinning the database the same way. It does not restart the process that is already stuck.

## Fixes in this change

- Request caps are counted before the admission lock. If that precheck fails open, the locked check still enforces the same strings. Dollar limits are unchanged and still use the lock.
- The admission transaction sets a local `lock_timeout` of 3 seconds before `pg_advisory_xact_lock`, then clears it. PostgreSQL `55P03` becomes `ApiUsageBlockedError` (`admissionBusyMessage`) and the connection is released on rollback. A busy ledger no longer holds a pool slot for the 15 second web statement timeout or the 120 second worker timeout. Under-cap calls that get the lock still complete the same dollar checks.
- Reply saves time out in the browser after 20 seconds, toast the result, and do not refresh Today a second time. Follow-up queue calls on the review route give up after 8 seconds so a stuck enqueue cannot hold the HTTP response. The review itself is already committed. `POST /api/replies/[id]/review` catches `MissingTenantContextError` and returns 401 with no write. There is no separate replies preview route; that line on `main` is this review handler.
- Today binds the signed-in organization with `bindRequestOrg` before the rest of the loaders run, so a later `resolveTenantOrgId()` uses that store and does not read cookies again. A missing tenant still renders a plain account page. Other read failures become warnings, not a process-killing error.
- Tab-focus refresh on Today is debounced to 20 seconds.
- The work-queue reply query uses the same open-review predicate as the Needs your read list, including replies whose subcontractor row is missing and replies linked only through the solicitation's org.
- When paid AI is stopped, the shell shows a banner and the nav does not say automation is running. The notice names daily requests, daily dollars, the monthly budget, or a pause, with used, remaining, and ceiling. Raising the monthly budget is not described as a way to clear a daily request cap. Reply cards say the assistant stopped because of the limit. They do not call that a pattern match.
- Migration `143_daily_request_ceiling_5000.sql` sets `api_account_budgets.daily_requests` from 1000 to 5000 and raises the global platform `api_usage_limits.daily_requests` row from 1000 to 5000. `DEFAULT_PLATFORM_REQUESTS` is 5000 so a missing global row cannot keep the old ceiling. Monthly dollar columns are not updated. Accounts with any other daily request value, including the code default of 100 for a row that has never been set to 1000, are left alone.

## Expected workflows

Confirmed from code:

- Today is the operator home. The headline count is `needsYou(workQueue())`, not the length of a capped preview.
- Workbench reply outcomes save immediately through `AdvanceAction`. The Today list still has a separate Save review control.
- `POST /api/replies/[id]/review` does not call the model. It records the outcome, then may enqueue follow-up work.
- Pause stops automatic sending. Outreach still uses recipient timezone, then org timezone, then America/Boise, on weekdays from 9 to 5.
- Roles and capabilities stay in `lib/domain/roles.ts`. This change does not widen them.

Assumed until a live check after republish: the 0-byte hang was the admission-lock pile-up above, and the published build was behind `origin/main` when the outage was recorded.

## Verification

Executed in this workspace: unit tests listed in the pull request for spending notices, reply extraction, automation health, and the related source guards.

Not executed: production HTTP, production database migration, paid model calls, browser clicks on brostco.com, or a worker boot against the live database. Do not treat a green unit run as proof the current edge process is answering.

## Still needs Jared or Kai

- Restart or republish the hung Replit deployment. This pull request does not do that, and it must not be merged until tip GO.
- Migration 143 has to run on the production database before the stored 1000 ceilings move. The code default alone does not change an existing `api_account_budgets` row or an existing global `api_usage_limits` row.
- Monthly budget stays at the stored $1000. Changing it is a settings decision, not part of this fix.
