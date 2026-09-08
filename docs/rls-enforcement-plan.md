# Tenant RLS enforcement plan

Status: staged, not ready for a restricted production runtime role.

Migration `107_tenant_rls_policies_staged.sql` adds PostgreSQL RLS policies to
every eligible current public table with a UUID `org_id`, plus `organizations`.
Ten context-free or shared-default tables receive explicit restrictive deny
policies until their access paths are redesigned. Each ordinary tenant table
receives both a permissive access policy and an equivalent restrictive boundary
policy. The restrictive policy is required because PostgreSQL combines
permissive policies with `OR`; without it, a later feature policy could
accidentally widen tenant access.

The migration intentionally uses `ENABLE ROW LEVEL SECURITY`, not `FORCE ROW
LEVEL SECURITY`. The existing web and worker connection owns the tables and
therefore still bypasses these policies. Forcing the policies or switching the
runtime to a non-owner role now would cause an outage. The staged policies are
defense ready, but they are not yet defense active.

## Transaction context contract

`tenantTransaction(orgId, callback)` in `lib/db.ts` is the only supported
context primitive for tenant-owned database work under RLS. It:

- validates the organization identifier;
- refuses to replace a different active AsyncLocalStorage organization;
- begins one database transaction;
- assigns `brostco.org_id` with `set_config(..., true)`;
- supplies that transaction's `PoolClient` for every callback query; and
- commits or rolls back before releasing the pooled connection.

The `true` argument makes the setting transaction local. A session-level
setting must never be used with a connection pool because the next request can
receive the same physical connection. The custom GUC selects the already
authenticated organization. It is not authorization by itself because a SQL
session can assign custom GUC values.

## Blocking architecture work

The following work must be completed before the web or tenant worker uses a
non-owner database role:

1. Authentication currently reads `sessions`, `users`, and
   `user_email_aliases` before an organization context exists. Password reset
   and invitation acceptance have the same pre-authentication requirement.
   Move those operations behind narrowly granted database APIs or introduce a
   separately constrained authentication role. Do not grant broad table reads
   to solve the context bootstrap problem.
2. Most page and route helpers resolve an organization in application code and
   then issue independent pooled queries. Convert each complete request
   mutation/read unit to `tenantTransaction`; setting context on one query does
   not protect a later query that receives another pooled connection.
3. Queue provenance deliberately reads the record owner before
   `runWithOrg`. Replace that pre-context read with a constrained provenance
   function or a separately privileged dispatcher that returns only the
   verified organization and work identity.
4. Organization fanout, platform recap, platform health, account
   administration, retention, and billing administration are cross-tenant
   operations. Move them to a separate maintenance process/role with explicit
   platform authorization and an auditable invocation path. Never add a
   caller-controlled `brostco.rls_bypass` setting.
5. `app_settings` still encodes tenant ownership in a key prefix while its
   `org_id` remains null. Backfill a real owner, change every tenant query to
   filter that column, and represent truly platform-wide settings separately.
   Migration 107 intentionally leaves this table with no usable non-owner
   policy, so it fails closed.
6. `stripe_events` claims a provider event before the webhook can always
   resolve its organization. Put event claiming behind a narrowly granted
   webhook function/role and link the tenant as soon as evidence exists.
   Migration 107 intentionally leaves this table with no usable non-owner
   policy.
7. `templates` treats rows owned by the founding customer as defaults for
   every account. Split known-safe platform defaults into a platform-owned
   table, or copy them into each organization at creation. Do not encode a
   cross-tenant read exception in an RLS policy.
8. Anonymous analytics events have no tenant, while signed-in events do. Give
   anonymous events a constrained, sanitized insert API rather than broad
   access to the tenant event table.
9. `worker_heartbeat` is platform state. Give the worker a narrow write path
   and dashboard health a narrow read path instead of table-owner access.
10. Token-authenticated vendor and signed-file paths establish an organization
   after validating their token. Their downstream database work must use the
   same tenant transaction, not only AsyncLocalStorage.
11. Provision separate database credentials. The web and tenant worker roles
   must be `NOSUPERUSER`, `NOBYPASSRLS`, own no application table, and be unable
   to assume an owner, superuser, or `BYPASSRLS` role. The migration owner
   credential must be available only to the release job.

## Required validation before activation

1. Restore a recent production snapshot into an isolated database.
2. Pause all writers and apply migrations 102 through 110 with the dedicated
   migration owner.
3. Run `npm run db:verify-tenant-isolation` with `DATABASE_URL` set to the exact
   proposed runtime role and `MIGRATION_DATABASE_URL` set to the owner-only
   audit role. The one invocation uses each credential for its appropriate
   checks and must report no owner, superuser, `BYPASSRLS`, policy, grant,
   null-owner, relationship, or staged blocker failures.
4. Run the full database integration suite. Also run the explicit RLS probe on
   the isolated development database with `RUN_RLS_INTEGRATION=1`; it creates a
   temporary non-login role, proves cross-tenant reads/writes are blocked, and
   proves a reused pooled connection has no prior transaction context.
5. Exercise authentication, signup, invitations, tenant requests, vendor
   tokens, every queue agent, recovery, webhooks, platform administration,
   recaps, and retention using the exact proposed runtime roles.
6. Inspect `pg_policies`, runtime grants, role membership closure, and table
   ownership in the restored database. Do not infer production posture from
   migration source alone.
7. Switch one non-production environment to the restricted roles, then a
   controlled production canary with rollback credentials ready. Only remove
   the old owner credential from runtime after the complete workload passes.

Until all of those checks pass, migration 107 must be described as staged
policy installation, not active tenant isolation enforcement.
