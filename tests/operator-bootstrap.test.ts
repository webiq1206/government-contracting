/**
 * Env-driven operator provisioning (lib/operator-bootstrap). The db layer is
 * mocked so the boot path is exercised without a live Postgres.
 *
 * Covers the security-relevant guarantees: the plaintext OPERATOR_PASSWORD is
 * never stored, re-running at boot is idempotent, a rotated secret rotates the
 * stored hash, and a too-short password is refused rather than accepted.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface Row {
  id: string;
  email: string;
  password_hash: string;
}
const users: Row[] = [];
const calls: string[] = [];

vi.mock("../lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
    if (/^insert into users/i.test(sql.trim())) {
      users.push({
        id: `u${users.length + 1}`,
        email: params[0] as string,
        password_hash: params[1] as string,
      });
    } else if (/^update users/i.test(sql.trim())) {
      const u = users.find((x) => x.id === params[0]);
      if (u) u.password_hash = params[1] as string;
    }
    return { rows: [] };
  }),
  queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
    if (/from users where lower\(email\)/i.test(sql)) {
      return users.find((u) => u.email === params[0]) ?? null;
    }
    return null;
  }),
}));

const { ensureOperatorFromEnv } = await import("../lib/operator-bootstrap");
const { verifyPassword } = await import("../lib/auth");

describe("operator bootstrap from OPERATOR_EMAIL + OPERATOR_PASSWORD", () => {
  beforeEach(() => {
    users.length = 0;
    calls.length = 0;
    delete process.env.OPERATOR_PASSWORD_HASH;
  });

  it("creates the operator row at boot, storing only a scrypt hash", async () => {
    process.env.OPERATOR_EMAIL = "Owner@BrostCo.com";
    process.env.OPERATOR_PASSWORD = "correct-horse-battery";
    await ensureOperatorFromEnv();

    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("owner@brostco.com"); // lowercased
    expect(users[0].password_hash.startsWith("scrypt$")).toBe(true);
    expect(users[0].password_hash).not.toContain("correct-horse-battery");
    expect(verifyPassword("correct-horse-battery", users[0].password_hash)).toBe(true);
  });

  it("is idempotent when the password is unchanged", async () => {
    process.env.OPERATOR_EMAIL = "owner@brostco.com";
    process.env.OPERATOR_PASSWORD = "correct-horse-battery";
    await ensureOperatorFromEnv();
    const first = users[0].password_hash;
    calls.length = 0;
    await ensureOperatorFromEnv();

    expect(users).toHaveLength(1);
    expect(users[0].password_hash).toBe(first);
    expect(calls.some((c) => /^update users/i.test(c))).toBe(false);
  });

  it("rotates the hash when OPERATOR_PASSWORD changes", async () => {
    process.env.OPERATOR_EMAIL = "owner@brostco.com";
    process.env.OPERATOR_PASSWORD = "correct-horse-battery";
    await ensureOperatorFromEnv();
    process.env.OPERATOR_PASSWORD = "a-different-password";
    await ensureOperatorFromEnv();

    expect(users).toHaveLength(1);
    expect(verifyPassword("a-different-password", users[0].password_hash)).toBe(true);
    expect(verifyPassword("correct-horse-battery", users[0].password_hash)).toBe(false);
  });

  it("does nothing when OPERATOR_PASSWORD is absent (hash-only config)", async () => {
    process.env.OPERATOR_EMAIL = "owner@brostco.com";
    delete process.env.OPERATOR_PASSWORD;
    await ensureOperatorFromEnv();
    expect(users).toHaveLength(0);
  });

  it("refuses a password under 8 characters", async () => {
    process.env.OPERATOR_EMAIL = "owner@brostco.com";
    process.env.OPERATOR_PASSWORD = "short";
    await ensureOperatorFromEnv();
    expect(users).toHaveLength(0);
  });
});
