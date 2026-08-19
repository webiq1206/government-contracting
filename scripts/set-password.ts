/**
 * Break-glass password reset, run from the workspace shell.
 *
 * The emailed reset link is the normal way to change a forgotten password, and
 * boot-time provisioning deliberately never overwrites an existing account. So
 * when email delivery is down, there is otherwise no way back into an account
 * whose password has been lost. This is that way back.
 *
 * It talks to whichever database this shell is configured for, which in the
 * workspace is the production database unless USE_REPLIT_DEV_DB is set. That is
 * the point (the locked-out account is the live one), so the target is printed
 * before anything is written and the write only happens with --confirm.
 *
 * Usage:
 *   npx tsx scripts/set-password.ts <email> --confirm
 *
 * The password is never passed as an argument: it is typed at a prompt (echo
 * off) or piped in. An argument would sit in shell history and be readable from
 * the process list while the command runs.
 *
 * Accepts a login alias as well as the account's own address. Every existing
 * session for the account is signed out, exactly as an emailed reset does.
 */
import { createInterface } from "node:readline";
import { closePool, query, queryOne } from "../lib/db";
import { hashPassword } from "../lib/auth";
import { config } from "../lib/config";

/** "host/database" for the connection in use, with no credentials in it. */
function targetDescription(): string {
  try {
    const u = new URL(config.database.url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function usage(): void {
  console.error(
    "Usage: npx tsx scripts/set-password.ts <email> --confirm\n" +
      "  Sets the password for an existing account and signs out its sessions.\n" +
      "  The new password is typed at a prompt, never given as an argument.\n" +
      "  --confirm is required: this writes to a real database."
  );
}

/**
 * Reads the new password without it appearing on screen or in shell history.
 * A pipe is accepted too, for a recovery being run from a script.
 */
async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return chunks.join("").split("\n")[0].trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const muteable = rl as unknown as {
    output: NodeJS.WritableStream;
    _writeToOutput: (s: string) => void;
  };
  let muted = false;
  muteable._writeToOutput = (s: string) => {
    if (!muted) muteable.output.write(s);
  };
  const answer = await new Promise<string>((resolve) => {
    rl.question(prompt, (value) => resolve(value));
    muted = true;
  });
  rl.close();
  process.stdout.write("\n");
  return answer.trim();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--confirm");
  const positional = args.filter((a) => !a.startsWith("--"));
  const [emailArg] = positional;

  if (!emailArg || positional.length > 1) {
    if (positional.length > 1) {
      console.error(
        "Error: the password is not an argument. Run with the email only and type it at the prompt.\n"
      );
    }
    usage();
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();

  const isolated = config.database.isIsolatedDev;
  console.log(`Database: ${targetDescription()}`);
  console.log(`Target:   ${isolated ? "development (built-in Postgres)" : "LIVE (DATABASE_URL)"}`);

  // Resolved through the same lookup the login form uses, so an alias address
  // finds the same account here that it would sign in as.
  const { findUserByLoginEmail } = await import("../lib/auth");
  const user = await findUserByLoginEmail(email);
  if (!user) {
    console.error(
      `Error: no account matches "${email}" (checked account addresses and login aliases).`
    );
    process.exit(1);
  }
  console.log(`Account:  ${user.email} (role: ${user.role})`);

  if (!confirmed) {
    console.error(
      "\nRefusing to write without --confirm. Re-run the same command with --confirm to set the password."
    );
    process.exit(1);
  }

  const password = await readSecret("New password (not shown): ");
  // Matches the reset flow's floor rather than the weaker one the create script
  // uses, so the break-glass path cannot be how a weak password gets in.
  if (password.length < 10) {
    console.error("Error: password must be at least 10 characters. Nothing was changed.");
    process.exit(1);
  }
  if (process.stdin.isTTY) {
    const again = await readSecret("Type it again:          ");
    if (again !== password) {
      console.error("Error: the two entries did not match. Nothing was changed.");
      process.exit(1);
    }
  }

  // One transaction, because a partial recovery is worse than none: a new
  // password with an old session still live, or with an unspent reset link
  // still in someone's inbox, hands the account to whoever holds the leftover.
  // Nothing here is allowed to fail quietly and still be reported as done.
  const { transaction } = await import("../lib/db");
  const outcome = await transaction(async (client) => {
    await client.query(`update users set password_hash = $2 where id = $1`, [
      user.id,
      hashPassword(password),
    ]);
    // Any session opened under the old password is no longer trustworthy, and
    // this is what the emailed reset does too.
    const sessions = await client.query(`delete from sessions where user_id = $1`, [user.id]);
    // An outstanding reset link would let an old email undo what was just set.
    const tokens = await client.query(
      `update password_reset_tokens set used_at = now()
        where user_id = $1 and used_at is null`,
      [user.id]
    );
    return { sessions: sessions.rowCount ?? 0, tokens: tokens.rowCount ?? 0 };
  });

  console.log("\nPassword updated.");
  console.log(`  sessions signed out:      ${outcome.sessions}`);
  console.log(`  reset links invalidated:  ${outcome.tokens}`);
  console.log("  sign in with the new password at your site's /login page.");
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
