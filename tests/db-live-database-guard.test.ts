/**
 * A test run must not be able to open a connection to the live database.
 *
 * This guard exists because it already went wrong: an integration run reached
 * production and left thirty throwaway `@example.test` accounts, seventeen
 * organizations and twenty-seven sessions in the owner's real data, where they
 * were indistinguishable from genuine signups.
 *
 * Creating a pg Pool does not connect to anything, so these cases are safe to
 * run: they assert on whether `pool()` refuses, not on reachability.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("connecting to a database from a test run", () => {
  beforeEach(() => {
    vi.resetModules(); // lib/db memoizes its pool at module scope
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses when the target is DATABASE_URL rather than the development database", async () => {
    delete process.env.USE_REPLIT_DEV_DB;
    process.env.DATABASE_URL = "postgres://user:pw@live.example.com:5432/app";

    const { pool } = await import("../lib/db");
    expect(() => pool()).toThrow(/Refusing to run tests against this database/);
  });

  it("names both ways out in the refusal, so the fix does not require reading the source", async () => {
    delete process.env.USE_REPLIT_DEV_DB;
    process.env.DATABASE_URL = "postgres://user:pw@live.example.com:5432/app";

    const { pool } = await import("../lib/db");
    expect(() => pool()).toThrow(/USE_REPLIT_DEV_DB/);
    expect(() => pool()).toThrow(/ALLOW_TESTS_AGAINST_DATABASE_URL/);
  });

  it("allows the repl's own built-in Postgres, which is disposable", async () => {
    // This is how the suite normally runs; it must not be blocked. Asserted on
    // the refusal specifically rather than on not throwing at all, so the case
    // still means something in an environment that has no built-in Postgres
    // provisioned (there, pool() fails for an unrelated, honest reason).
    const { pool } = await import("../lib/db");
    try {
      pool();
    } catch (err) {
      expect(String(err)).not.toMatch(/Refusing to run tests against this database/);
    }
  });

  it("allows an explicit override for a database the caller says is disposable", async () => {
    delete process.env.USE_REPLIT_DEV_DB;
    process.env.DATABASE_URL = "postgres://user:pw@scratch.example.com:5432/app";
    process.env.ALLOW_TESTS_AGAINST_DATABASE_URL = "1";

    const { pool } = await import("../lib/db");
    expect(() => pool()).not.toThrow();
  });

  it("still guards a child process that carries NODE_ENV=test without VITEST", async () => {
    delete process.env.USE_REPLIT_DEV_DB;
    delete process.env.VITEST;
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres://user:pw@live.example.com:5432/app";

    const { pool } = await import("../lib/db");
    expect(() => pool()).toThrow(/Refusing to run tests against this database/);
  });
});
