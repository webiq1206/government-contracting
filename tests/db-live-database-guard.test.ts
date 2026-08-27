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
    /*
     * Clear the escape hatch by default.
     *
     * An integration run sets ALLOW_TESTS_AGAINST_DATABASE_URL=1 for the whole
     * process, and this file's refusal cases inherited it: the guard correctly
     * allowed the connection, the assertions failed, and the most important
     * check in the suite stopped checking anything in exactly the mode where
     * a live-database mistake is possible. The two cases that are about the
     * hatch set it themselves.
     */
    delete process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
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
    // This is how the suite normally runs; it must not be blocked. Set the
    // isolated-dev environment explicitly rather than leaning on the ambient
    // one: under GitHub Actions DATABASE_URL is present but USE_REPLIT_DEV_DB
    // and the PG* dev vars are not, so relying on the ambient env made the
    // guard (correctly) refuse and this assertion fail for the wrong reason.
    // Here the built-in database is a genuinely different server from
    // DATABASE_URL, which is exactly the case the guard is meant to allow.
    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.REPLIT_DEPLOYMENT_ID;
    delete process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
    process.env.USE_REPLIT_DEV_DB = "true";
    process.env.DATABASE_URL = "postgres://user:pw@live.example.com:5432/app";
    process.env.PGHOST = "127.0.0.1";
    process.env.PGPORT = "5432";
    process.env.PGDATABASE = "replit_dev";
    process.env.PGUSER = "replit";
    process.env.PGPASSWORD = "replit";

    const { pool } = await import("../lib/db");
    expect(() => pool()).not.toThrow();
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
