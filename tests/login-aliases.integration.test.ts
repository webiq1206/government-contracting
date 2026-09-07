/**
 * Login aliases: one account, several front doors.
 *
 * Creates its own throwaway user and cleans up afterwards, so it is safe to
 * run against the dev database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("signing in by alias (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let authenticate: typeof import("../lib/auth").authenticate;
  let findUserByLoginEmail: typeof import("../lib/auth").findUserByLoginEmail;
  let hashPassword: typeof import("../lib/auth").hashPassword;
  let emailTaken: typeof import("../lib/auth-signup").emailTaken;

  const tag = randomUUID().slice(0, 8);
  const PRIMARY = `alias-primary-${tag}@example.test`;
  const ALIAS = `alias-secondary-${tag}@example.test`;
  const OTHER = `alias-other-${tag}@example.test`;
  const PASSWORD = "correct horse battery staple";
  let userId = "";
  let otherId = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ authenticate, findUserByLoginEmail, hashPassword } = await import("../lib/auth"));
    ({ emailTaken } = await import("../lib/auth-signup"));

    const row = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role)
       values ($1, $2, 'Alias Test', 'operator') returning id`,
      [PRIMARY, hashPassword(PASSWORD)]
    );
    userId = row!.id;

    const other = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role)
       values ($1, $2, 'Other', 'operator') returning id`,
      [OTHER, hashPassword(PASSWORD)]
    );
    otherId = other!.id;

    await query(`insert into user_email_aliases (user_id, email) values ($1, $2)`, [
      userId,
      ALIAS,
    ]);
  });

  afterAll(async () => {
    if (!hasDb) return;
    // Aliases cascade with the user.
    await query(`delete from users where id = any($1::uuid[])`, [
      [userId, otherId].filter(Boolean),
    ]).catch(() => {});
  });

  it("resolves the alias to the same account", async () => {
    const viaPrimary = await findUserByLoginEmail(PRIMARY);
    const viaAlias = await findUserByLoginEmail(ALIAS);
    expect(viaAlias?.id).toBe(userId);
    expect(viaAlias?.id).toBe(viaPrimary?.id);
  });

  it("is case and whitespace insensitive, the way people type addresses", async () => {
    const found = await findUserByLoginEmail(`  ${ALIAS.toUpperCase()} `);
    expect(found?.id).toBe(userId);
  });

  it("authenticates by alias with the account's own password", async () => {
    const user = await authenticate(ALIAS, PASSWORD);
    expect(user?.id).toBe(userId);
  });

  /**
   * The alias is a front door, not a second identity. Everything downstream —
   * the session, the displayed address, the From line on outbound mail — has
   * to keep using the canonical address, or one person becomes two accounts
   * depending on how they signed in.
   */
  it("returns the canonical address, not the alias that was typed", async () => {
    const user = await authenticate(ALIAS, PASSWORD);
    expect(user?.email).toBe(PRIMARY);
  });

  it("still rejects a wrong password sent to an alias", async () => {
    expect(await authenticate(ALIAS, "not the password")).toBeNull();
  });

  it("does not invent an account for an address nobody owns", async () => {
    expect(await findUserByLoginEmail(`nobody-${tag}@example.test`)).toBeNull();
  });
});

/**
 * Uniqueness has to hold across BOTH tables. If signup could claim an address
 * that is already somebody's alias, it would hand a stranger a working sign-in
 * to an existing account — which is worse than any ordinary duplicate.
 */
d("an address can only belong to one account (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let hashPassword: typeof import("../lib/auth").hashPassword;
  let emailTaken: typeof import("../lib/auth-signup").emailTaken;

  const tag = randomUUID().slice(0, 8);
  const OWNER = `uniq-owner-${tag}@example.test`;
  const CLAIMED = `uniq-claimed-${tag}@example.test`;
  let ownerId = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ hashPassword } = await import("../lib/auth"));
    ({ emailTaken } = await import("../lib/auth-signup"));

    const row = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, role) values ($1, $2, 'operator') returning id`,
      [OWNER, hashPassword("correct horse battery staple")]
    );
    ownerId = row!.id;
    await query(`insert into user_email_aliases (user_id, email) values ($1, $2)`, [
      ownerId,
      CLAIMED,
    ]);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await query(`delete from users where id = $1`, [ownerId]).catch(() => {});
    await query(`delete from users where email = $1`, [CLAIMED]).catch(() => {});
  });

  it("reports an alias as taken, so signup refuses it with a sentence", async () => {
    expect(await emailTaken(CLAIMED)).toBe(true);
    expect(await emailTaken(CLAIMED.toUpperCase())).toBe(true);
    expect(await emailTaken(OWNER)).toBe(true);
    expect(await emailTaken(`free-${tag}@example.test`)).toBe(false);
  });

  /**
   * The application check above is for the error message. This is the actual
   * guarantee, and it holds against code paths that forget to ask.
   */
  it("refuses at the database level to create a user on somebody's alias", async () => {
    await expect(
      query(`insert into users (email, password_hash, role) values ($1, 'x', 'operator')`, [
        CLAIMED,
      ])
    ).rejects.toThrow();
  });

  it("refuses to alias an address that is already an account", async () => {
    await expect(
      query(`insert into user_email_aliases (user_id, email) values ($1, $2)`, [
        ownerId,
        OWNER.toUpperCase(),
      ])
    ).rejects.toThrow();
  });

  it("refuses a duplicate alias regardless of case", async () => {
    await expect(
      query(`insert into user_email_aliases (user_id, email) values ($1, $2)`, [
        ownerId,
        CLAIMED.toUpperCase(),
      ])
    ).rejects.toThrow();
  });
});
