/**
 * CLI script to create an admin/operator/viewer user in the database.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts <email> <password> [role]
 *
 * Role defaults to "operator". Valid values: operator | admin | viewer
 */
import { closePool, queryOne, query } from "../lib/db";
import { hashPassword } from "../lib/auth";

const VALID_ROLES = ["operator", "admin", "viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

function usage(): void {
  console.error(
    "Usage: npx tsx scripts/create-user.ts <email> <password> [role]\n" +
      "  role defaults to 'operator'. Valid roles: operator, admin, viewer"
  );
}

async function main(): Promise<void> {
  const [, , emailArg, passwordArg, roleArg] = process.argv;

  if (!emailArg || !passwordArg) {
    usage();
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();
  const password = passwordArg;
  const role: string = roleArg ?? "operator";

  if (!VALID_ROLES.includes(role as Role)) {
    console.error(`Error: invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
    usage();
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Error: password must be at least 8 characters.");
    process.exit(1);
  }

  const existing = await queryOne<{ id: string }>(
    "select id from users where email = $1",
    [email]
  );

  if (existing) {
    console.error(`Error: a user with email "${email}" already exists (id: ${existing.id}).`);
    process.exit(1);
  }

  const passwordHash = hashPassword(password);

  const row = await queryOne<{ id: string; email: string; role: string }>(
    `insert into users (email, password_hash, role)
     values ($1, $2, $3)
     returning id, email, role`,
    [email, passwordHash, role]
  );

  if (!row) {
    console.error("Error: insert returned no row. The user was not created.");
    process.exit(1);
  }

  console.log("User created successfully:");
  console.log(`  id:    ${row.id}`);
  console.log(`  email: ${row.email}`);
  console.log(`  role:  ${row.role}`);
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
