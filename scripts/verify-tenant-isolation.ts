/**
 * Read-only production tenant-isolation gate.
 *
 * Run this after migrations and before enabling production traffic:
 *
 *   DATABASE_URL=<restricted-runtime-url> \
 *   MIGRATION_DATABASE_URL=<owner-audit-url> \
 *   npm run db:verify-tenant-isolation
 *
 * It exits nonzero when database enforcement, legacy data, PostgREST
 * lockdown, or the runtime database role leaves a tenant boundary open.
 * Runtime posture and policy checks use DATABASE_URL. Whole-database legacy
 * integrity checks use MIGRATION_DATABASE_URL with row_security disabled so
 * hidden rows cannot produce a false pass. It never prints record ids,
 * organization ids, customer names, or secrets.
 */
import "../lib/env";
import type { Client, QueryResultRow } from "pg";
import { closePool, query, queryOne, standaloneClient } from "../lib/db";
import { config } from "../lib/config";

type Status = "PASS" | "FAIL" | "WARN";

interface Finding {
  status: Status;
  title: string;
  fix?: string;
}

const findings: Finding[] = [];
let integrityClient: Client | null = null;

function record(status: Status, title: string, fix?: string): void {
  findings.push({ status, title, fix });
}

/**
 * Live-data checks must bypass RLS or they can mistake hidden violations for
 * a clean database. DATABASE_URL is deliberately the restricted runtime role;
 * this connection comes from the owner-only release credential.
 */
async function integrityQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!integrityClient) throw new Error("The integrity connection is not ready.");
  return (await integrityClient.query<T>(text, params as never[])).rows;
}

async function integrityQueryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  return (await integrityQuery<T>(text, params))[0] ?? null;
}

const REQUIRED_OWNERS = [
  "company_profile",
  "scoring_weights",
  "opportunities",
  "subcontractors",
  "opportunity_subs",
  "quotes",
  "pricing_comps",
  "bids",
  "contracts",
  "communications",
  "documents",
  "templates",
  "compliance_items",
  "call_cards",
  "content_library",
  "custom_kpis",
  "file_blobs",
  "subcontractor_reply_events",
  "subcontractor_documents",
  "subcontractor_payments",
  "reply_drafts",
  "backlink_competitors",
  "backlink_prospects",
  "backlink_outreach",
  "backlinks",
  "authority_snapshots",
] as const;

function ident(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

interface RolePosture {
  role_name: string;
  is_superuser: boolean;
  bypasses_rls: boolean;
  owned_unforced_tables: number;
  owner_role_memberships: number;
  elevated_role_memberships: number;
}

async function verifyRuntimeRole(): Promise<void> {
  const role = await queryOne<RolePosture>(
    `select r.rolname as role_name,
            r.rolsuper as is_superuser,
            r.rolbypassrls as bypasses_rls,
            (select count(*)::int
               from pg_catalog.pg_class c
               join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relkind in ('r','p')
                and not c.relforcerowsecurity
                and c.relowner = r.oid) as owned_unforced_tables,
            (select count(distinct c.relowner)::int
               from pg_catalog.pg_class c
               join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relkind in ('r','p')
                and not c.relforcerowsecurity
                and pg_catalog.pg_has_role(r.oid, c.relowner, 'member')) as owner_role_memberships
            ,(select count(*)::int
                from pg_catalog.pg_roles elevated
               where elevated.oid <> r.oid
                 and (elevated.rolsuper or elevated.rolbypassrls)
                 and pg_catalog.pg_has_role(r.oid, elevated.oid, 'member')) as elevated_role_memberships
       from pg_catalog.pg_roles r
      where r.rolname = current_user`
  );

  if (!role) {
    record(
      "FAIL",
      "The runtime database role could not be inspected",
      "Run the gate with the exact DATABASE_URL used by the web and worker processes."
    );
    return;
  }

  if (
    role.is_superuser ||
    role.bypasses_rls ||
    role.owned_unforced_tables > 0 ||
    role.owner_role_memberships > 0 ||
    role.elevated_role_memberships > 0
  ) {
    record(
      "FAIL",
      `Runtime role ${role.role_name} can bypass row-level security`,
      "Use separate migration and runtime roles. The runtime role must be NOSUPERUSER, NOBYPASSRLS, must not own application tables, and must not be able to assume a table-owner, superuser, or BYPASSRLS role. Before switching it, add and test tenant-scoped RLS policies driven by a transaction-local organization context."
    );
    return;
  }

  record("PASS", `Runtime role ${role.role_name} cannot bypass row-level security`);
}

interface TableNameRow {
  table_name: string;
}

async function verifyRlsAndGrants(): Promise<void> {
  const rlsGaps = await query<TableNameRow>(
    `select c.relname as table_name
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r','p')
        and not c.relrowsecurity
      order by c.relname`
  );
  if (rlsGaps.length) {
    record(
      "FAIL",
      `${rlsGaps.length} public table(s) do not have row-level security enabled`,
      `Enable RLS before release. Tables: ${rlsGaps.map((r) => r.table_name).join(", ")}`
    );
  } else {
    record("PASS", "Every public application table has row-level security enabled");
  }

  const grants = await query<{ table_name: string; grantee: string; privilege_type: string }>(
    `select c.relname as table_name,
            case when acl.grantee = 0 then 'PUBLIC' else grant_role.rolname end as grantee,
            acl.privilege_type
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) acl
       left join pg_catalog.pg_roles grant_role on grant_role.oid = acl.grantee
      where n.nspname = 'public'
        and c.relkind in ('r','p')
        and (acl.grantee = 0 or lower(grant_role.rolname) in ('anon','authenticated'))
      order by c.relname, grantee, acl.privilege_type`
  );
  if (grants.length) {
    const tables = [...new Set(grants.map((g) => g.table_name))];
    record(
      "FAIL",
      `${grants.length} untrusted PostgREST table grant(s) remain`,
      `Revoke the grants before release. Tables: ${tables.join(", ")}`
    );
  } else {
    record("PASS", "Public, anon, and authenticated have no application-table grants");
  }
}

interface RlsPolicyRow {
  table_name: string;
  policy_name: string;
  permissive: boolean;
  command: string;
  using_expression: string | null;
  check_expression: string | null;
}

const RLS_STAGED_BLOCKERS = new Map<string, string>([
  [
    "account_invitations",
    "Move invitation lookup and acceptance behind a constrained pre-authentication database API before a restricted runtime role is enabled.",
  ],
  [
    "analytics_events",
    "Separate anonymous product events from tenant-owned events and define a constrained insert path before a restricted runtime role is enabled.",
  ],
  [
    "app_settings",
    "Backfill app_settings.org_id and replace tenant ownership encoded only in key prefixes before a restricted runtime role is enabled.",
  ],
  [
    "password_reset_tokens",
    "Move password-reset issuance and consumption behind a constrained pre-authentication database API before a restricted runtime role is enabled.",
  ],
  [
    "sessions",
    "Move session authentication behind a narrowly granted database API that establishes the trusted user and organization context.",
  ],
  [
    "stripe_events",
    "Move pre-tenant Stripe event claims behind a narrowly granted webhook database path before a restricted runtime role is enabled.",
  ],
  [
    "templates",
    "Separate platform template defaults from the founding customer's tenant-owned template rows, or copy known-safe defaults into each account before a restricted runtime role is enabled.",
  ],
  [
    "user_email_aliases",
    "Move login alias resolution behind the same constrained authentication database API as users and sessions.",
  ],
  [
    "users",
    "Move login and signup identity access behind constrained authentication and onboarding database APIs before a restricted runtime role is enabled.",
  ],
  [
    "worker_heartbeat",
    "Give heartbeat reads and writes a dedicated platform-worker path rather than tenant or table-owner access.",
  ],
]);

function hasContextExpression(value: string | null, ownerColumn: "id" | "org_id"): boolean {
  const sql = (value ?? "").toLowerCase();
  return (
    sql.includes("current_setting") &&
    sql.includes("brostco.org_id") &&
    new RegExp(`\\b${ownerColumn}\\b`).test(sql)
  );
}

/**
 * Verify both halves of the RLS policy set.
 *
 * The permissive policy makes the intended row available. The duplicate
 * restrictive policy is intentional: PostgreSQL ORs permissive policies, so
 * a future feature policy must not be able to widen this tenant boundary.
 */
async function verifyTenantRlsPolicies(): Promise<void> {
  const tables = await query<TableNameRow>(
    `select c.relname as table_name
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r','p')
        and (
          c.relname = 'organizations'
          or c.relname = any($1::text[])
          or exists (
            select 1
              from pg_catalog.pg_attribute a
             where a.attrelid = c.oid
               and a.attname = 'org_id'
               and not a.attisdropped
               and a.atttypid = 'uuid'::pg_catalog.regtype
          )
        )
      order by c.relname`,
    [[...RLS_STAGED_BLOCKERS.keys()]]
  );
  const policies = await query<RlsPolicyRow>(
    `select c.relname as table_name,
            p.polname as policy_name,
            p.polpermissive as permissive,
            p.polcmd as command,
            pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expression,
            pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
       from pg_catalog.pg_policy p
       join pg_catalog.pg_class c on c.oid = p.polrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
      order by c.relname, p.polname`
  );

  let complete = 0;
  for (const table of tables) {
    const rows = policies.filter((policy) => policy.table_name === table.table_name);
    const blocker = RLS_STAGED_BLOCKERS.get(table.table_name);
    if (blocker) {
      const deny = rows.find(
        (policy) =>
          policy.policy_name === "brostco_staged_deny" &&
          !policy.permissive &&
          policy.command === "*" &&
          policy.using_expression?.toLowerCase() === "false" &&
          policy.check_expression?.toLowerCase() === "false"
      );
      if (!deny) {
        record(
          "FAIL",
          `${table.table_name} is a staged blocker without an explicit deny policy`,
          "Reapply migration 107 before any non-owner role receives table privileges."
        );
      }
      record(
        "FAIL",
        `${table.table_name} is intentionally denied to a non-owner runtime`,
        blocker
      );
      continue;
    }

    const ownerColumn = table.table_name === "organizations" ? "id" : "org_id";

    const access = rows.find(
      (policy) =>
        policy.policy_name === "brostco_tenant_access" &&
        policy.permissive &&
        policy.command === "*"
    );
    const boundary = rows.find(
      (policy) =>
        policy.policy_name === "brostco_tenant_boundary" &&
        !policy.permissive &&
        policy.command === "*"
    );
    const ready =
      hasContextExpression(access?.using_expression ?? null, ownerColumn) &&
      hasContextExpression(access?.check_expression ?? null, ownerColumn) &&
      hasContextExpression(boundary?.using_expression ?? null, ownerColumn) &&
      hasContextExpression(boundary?.check_expression ?? null, ownerColumn);

    if (ready) {
      complete++;
    } else {
      record(
        "FAIL",
        `${table.table_name} lacks a complete restrictive tenant policy`,
        "Apply migration 107_tenant_rls_policies_staged.sql as the migration owner."
      );
    }
  }

  const expected = tables.length - [...RLS_STAGED_BLOCKERS.keys()].filter((name) =>
    tables.some((table) => table.table_name === name)
  ).length;
  if (complete === expected) {
    record(
      "PASS",
      `${complete} tenant-owned table(s) have permissive access plus a restrictive organization boundary`
    );
  }
}

interface OwnerConstraintRow {
  table_name: string;
  constraint_name: string;
  validated: boolean;
}

async function verifyRequiredOwners(): Promise<void> {
  const constraints = await integrityQuery<OwnerConstraintRow>(
    `select c.relname as table_name,
            con.conname as constraint_name,
            con.convalidated as validated
       from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and con.conname = c.relname || '_org_id_present_ck'
      order by c.relname`
  );
  const byTable = new Map(constraints.map((row) => [row.table_name, row]));

  for (const table of REQUIRED_OWNERS) {
    const constraint = byTable.get(table);
    if (!constraint) {
      record(
        "FAIL",
        `${table}.org_id is not protected against null ownership`,
        "Apply migration 106_tenant_relationship_guards.sql before release."
      );
      continue;
    }

    const result = await integrityQueryOne<{ count: number }>(
      `select count(*)::int as count from public.${ident(table)} where org_id is null`
    );
    const orphanCount = result?.count ?? 0;
    if (orphanCount > 0) {
      record(
        "FAIL",
        `${table} has ${orphanCount} row(s) without an organization owner`,
        "Map each row from auditable business evidence. Do not assign unknown rows to the founding tenant by default. Rerun this gate after cleanup."
      );
      continue;
    }

    if (!constraint.validated) {
      record(
        "FAIL",
        `${table}.org_id has no legacy nulls but its check is not validated`,
        `Run: ALTER TABLE public.${ident(table)} VALIDATE CONSTRAINT ${ident(constraint.constraint_name)};`
      );
      continue;
    }

    record("PASS", `${table}.org_id is present and validated`);
  }
}

async function verifyOwnershipGuards(): Promise<void> {
  const gaps = await integrityQuery<TableNameRow>(
    `select c.relname as table_name
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       join pg_catalog.pg_attribute org_column
         on org_column.attrelid = c.oid
        and org_column.attname = 'org_id'
        and not org_column.attisdropped
      where n.nspname = 'public'
        and c.relkind in ('r','p')
        and not exists (
          select 1
            from pg_catalog.pg_trigger t
            join pg_catalog.pg_proc p on p.oid = t.tgfoid
            join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
           where t.tgrelid = c.oid
             and not t.tgisinternal
             and t.tgenabled in ('O','A')
             and (t.tgtype & 1) = 1
             and (t.tgtype & 2) = 2
             and (t.tgtype & 16) = 16
             and org_column.attnum = any(t.tgattr::smallint[])
             and pn.nspname = 'public'
             and p.proname = 'prevent_tenant_reassignment'
             and p.prosecdef
             and 'search_path=pg_catalog' = any(coalesce(p.proconfig, '{}'::text[]))
        )
      order by c.relname`
  );

  if (gaps.length) {
    record(
      "FAIL",
      `${gaps.length} tenant-owned table(s) lack an enabled ownership-immutability trigger`,
      `Reapply the migration-owner guard installer and investigate trigger drift before release. Tables: ${gaps.map((row) => row.table_name).join(", ")}`
    );
  } else {
    record("PASS", "Every tenant-owned table has an enabled ownership-immutability trigger");
  }
}

interface TenantReferenceRow {
  constraint_name: string;
  validated: boolean;
  child_schema: string;
  child_table: string;
  child_column: string;
  parent_schema: string;
  parent_table: string;
  guard_count: number;
}

async function tenantReferences(): Promise<TenantReferenceRow[]> {
  return integrityQuery<TenantReferenceRow>(
    `select fk.conname as constraint_name,
            fk.convalidated as validated,
            child_ns.nspname as child_schema,
            child.relname as child_table,
            child_col.attname as child_column,
            parent_ns.nspname as parent_schema,
            parent.relname as parent_table,
            (select count(*)::int
               from pg_catalog.pg_trigger t
               join pg_catalog.pg_proc p on p.oid = t.tgfoid
               join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
              where t.tgrelid = child.oid
                and not t.tgisinternal
                and pn.nspname = 'public'
                and p.proname = 'enforce_tenant_reference'
                and pg_catalog.encode(t.tgargs, 'escape') like '%' || child_col.attname || '%'
            ) as guard_count
       from pg_catalog.pg_constraint fk
       join pg_catalog.pg_class child on child.oid = fk.conrelid
       join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
       join pg_catalog.pg_class parent on parent.oid = fk.confrelid
       join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
       join pg_catalog.pg_attribute child_col
         on child_col.attrelid = fk.conrelid
        and child_col.attnum = fk.conkey[1]
       join pg_catalog.pg_attribute parent_col
         on parent_col.attrelid = fk.confrelid
        and parent_col.attnum = fk.confkey[1]
      where fk.contype = 'f'
        and child_ns.nspname = 'public'
        and parent_ns.nspname = 'public'
        and array_length(fk.conkey, 1) = 1
        and array_length(fk.confkey, 1) = 1
        and child_col.atttypid = 'uuid'::regtype
        and parent_col.atttypid = 'uuid'::regtype
        and parent_col.attname = 'id'
        and exists (
          select 1 from pg_catalog.pg_attribute a
           where a.attrelid = child.oid and a.attname = 'org_id' and not a.attisdropped
        )
        and exists (
          select 1 from pg_catalog.pg_attribute a
           where a.attrelid = parent.oid and a.attname = 'org_id' and not a.attisdropped
        )
      order by child.relname, child_col.attname`
  );
}

async function verifyReferences(): Promise<void> {
  const references = await tenantReferences();
  if (!references.length) {
    record(
      "FAIL",
      "No tenant-owned foreign-key relationships were discovered",
      "Apply migration 106 and confirm this gate is pointed at the intended database."
    );
    return;
  }

  let missingGuards = 0;
  let mismatches = 0;
  for (const ref of references) {
    if (ref.guard_count < 1) {
      missingGuards++;
      record(
        "FAIL",
        `${ref.child_table}.${ref.child_column} has no tenant-reference guard`,
        "Run SELECT public.install_tenant_reference_guards(); as the migration owner, then revoke access to that function again."
      );
    }

    const result = await integrityQueryOne<{ count: number }>(
      `select count(*)::int as count
         from ${ident(ref.child_schema)}.${ident(ref.child_table)} child
         left join ${ident(ref.parent_schema)}.${ident(ref.parent_table)} parent
           on parent.id = child.${ident(ref.child_column)}
        where child.${ident(ref.child_column)} is not null
          and (
            parent.id is null
            or child.org_id is null
            or parent.org_id is null
            or child.org_id <> parent.org_id
          )`
    );
    const count = result?.count ?? 0;
    if (count > 0) {
      mismatches += count;
      record(
        "FAIL",
        `${ref.child_table}.${ref.child_column} has ${count} dangling, cross-tenant, or unowned reference(s)`,
        "Repair the relationship from source evidence inside a reviewed transaction. Never infer ownership from the currently signed-in tenant."
      );
    }

    if (!ref.validated && count === 0) {
      record(
        "FAIL",
        `${ref.child_table}.${ref.child_column} is clean but its foreign key is not validated`,
        `Run: ALTER TABLE ${ident(ref.child_schema)}.${ident(ref.child_table)} VALIDATE CONSTRAINT ${ident(ref.constraint_name)};`
      );
    }
  }

  if (missingGuards === 0) {
    record("PASS", `All ${references.length} tenant-owned foreign keys have write guards`);
  }
  if (mismatches === 0) {
    record("PASS", `All ${references.length} tenant-owned foreign keys match their parent organization`);
  }
}

async function verifyBacklinkKeys(): Promise<void> {
  const indexes = await integrityQuery<{ indexname: string; indexdef: string }>(
    `select indexname, indexdef
       from pg_catalog.pg_indexes
      where schemaname = 'public'
        and indexname in (
          'backlink_competitors_org_domain_uniq',
          'backlink_prospects_org_domain_type_uniq',
          'backlinks_org_source_target_uniq'
        )`
  );
  const expected = new Map<string, RegExp>([
    ["backlink_competitors_org_domain_uniq", /\(org_id, domain\)$/],
    [
      "backlink_prospects_org_domain_type_uniq",
      /\(org_id, domain, opportunity_type\)$/,
    ],
    ["backlinks_org_source_target_uniq", /\(org_id, source_url, target_url\)$/],
  ]);
  const malformed = [...expected].filter(([name, columns]) => {
    const row = indexes.find((index) => index.indexname === name);
    if (!row) return true;
    const normalized = row.indexdef.toLowerCase().replaceAll('"', "").replace(/\s+/g, " ");
    return !normalized.startsWith("create unique index ") || !columns.test(normalized);
  });
  if (malformed.length) {
    record(
      "FAIL",
      "Tenant-scoped backlink uniqueness is incomplete",
      `Apply migration 106 before running the backlink worker. Missing or incorrect indexes: ${malformed.map(([name]) => name).join(", ")}`
    );
  } else {
    record("PASS", "Backlink deduplication keys are tenant-scoped");
  }

  const legacy = await integrityQuery<{ constraint_name: string }>(
    `select conname as constraint_name
       from pg_catalog.pg_constraint
      where conname in (
        'backlink_competitors_domain_key',
        'backlink_prospects_domain_opportunity_type_key',
        'backlinks_source_url_target_url_key'
      )`
  );
  if (legacy.length) {
    record(
      "FAIL",
      "Global backlink uniqueness constraints still couple tenant data",
      `Remove only after the replacement tenant indexes exist. Constraints: ${legacy.map((r) => r.constraint_name).join(", ")}`
    );
  }
}

function finish(): never | void {
  console.log("\nBROSTCO tenant isolation gate\n" + "=".repeat(38));
  for (const finding of findings) {
    console.log(`${finding.status.padEnd(4)} ${finding.title}`);
    if (finding.fix) console.log(`     Next: ${finding.fix}`);
  }

  const failures = findings.filter((finding) => finding.status === "FAIL").length;
  const warnings = findings.filter((finding) => finding.status === "WARN").length;
  console.log("=".repeat(38));
  console.log(`${failures} failure(s), ${warnings} warning(s), ${findings.length} check(s)`);
  if (failures > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!ownerUrl && config.isProd && !config.database.isIsolatedDev) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required for exhaustive tenant-integrity verification. DATABASE_URL must remain the restricted runtime role."
    );
  }
  integrityClient = standaloneClient({
    queryTimeoutMs: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 120_000),
    applicationName: "brostco-tenant-integrity-verifier",
    connectionString: ownerUrl || config.database.url,
  });
  await integrityClient.connect();
  // A non-owner cannot silently receive policy-filtered results with this
  // setting: PostgreSQL errors instead. The migration owner continues to see
  // the complete tables and can prove there are no hidden legacy violations.
  await integrityClient.query("set row_security = off");

  await verifyRuntimeRole();
  await verifyRlsAndGrants();
  await verifyTenantRlsPolicies();
  await verifyRequiredOwners();
  await verifyOwnershipGuards();
  await verifyReferences();
  await verifyBacklinkKeys();
  finish();
}

main()
  .catch((error) => {
    console.error("Tenant isolation gate could not complete:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([
      closePool().catch(() => {}),
      integrityClient?.end().catch(() => {}),
    ]);
  });
