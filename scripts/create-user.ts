/**
 * CLI script to create an admin/operator/viewer user in the database.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts <email> <password> [role] [org-id]
 *
 * Role defaults to "operator". Organization defaults to the founding account
 * for backwards compatibility with this operator-only maintenance command.
 */
import { closePool, transaction } from "../lib/db";
import { hashPassword } from "../lib/auth";
import { LEGACY_ORG_ID } from "../lib/tenant-context";

const VALID_ROLES = ["operator", "admin", "viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

function usage(): void {
  console.error(
    "Usage: npx tsx scripts/create-user.ts <email> <password> [role] [org-id]\n" +
      "  role defaults to 'operator'. Valid roles: operator, admin, viewer\n" +
      `  org-id defaults to the founding operator account (${LEGACY_ORG_ID}).`
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const [, , emailArg, passwordArg, roleArg, orgIdArg] = process.argv;

  if (!emailArg || !passwordArg) {
    usage();
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();
  const password = passwordArg;
  const role: string = roleArg ?? "operator";
  const orgId = orgIdArg?.trim() || LEGACY_ORG_ID;

  if (!VALID_ROLES.includes(role as Role)) {
    console.error(`Error: invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
    usage();
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Error: password must be at least 8 characters.");
    process.exit(1);
  }

  if (!UUID.test(orgId)) {
    console.error(`Error: organization id "${orgId}" is not a valid UUID.`);
    process.exit(1);
  }

  const passwordHash = hashPassword(password);
  const created = await transaction(async (client) => {
    const organization = await client.query<{ id: string; name: string }>(
      `select id, name from organizations where id = $1`,
      [orgId]
    );
    const org = organization.rows[0];
    if (!org) {
      throw new Error(
        `Organization ${orgId} does not exist. No user or membership was created.`
      );
    }

    const existing = await client.query<{ id: string }>(
      `select id from users where lower(email) = $1`,
      [email]
    );
    if (existing.rows[0]) {
      throw new Error(
        `A user with email "${email}" already exists (id: ${existing.rows[0].id}). No membership was changed.`
      );
    }

    const inserted = await client.query<{ id: string; email: string; role: string }>(
      `insert into users (email, password_hash, role)
       values ($1, $2, $3)
       returning id, email, role`,
      [email, passwordHash, role]
    );
    const user = inserted.rows[0];
    if (!user) throw new Error("User insert returned no row.");

    await client.query(
      `insert into organization_members (org_id, user_id, role)
       values ($1, $2, $3)
       on conflict (org_id, user_id) do update set role = excluded.role`,
      [org.id, user.id, role]
    );
    return { user, org };
  });

  console.log("User and organization membership created successfully:");
  console.log(`  id:                ${created.user.id}`);
  console.log(`  email:             ${created.user.email}`);
  console.log(`  platform role:     ${created.user.role}`);
  console.log(`  organization:      ${created.org.name} (${created.org.id})`);
  console.log(`  organization role: ${created.user.role}`);
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
