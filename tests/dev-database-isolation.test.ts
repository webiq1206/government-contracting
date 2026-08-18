/**
 * Development must not be able to touch production.
 *
 * The workspace and the published app used to read the same DATABASE_URL, so
 * the development worker executed real customer jobs against live data, a
 * workspace restart killed work that was in flight, and two schedulers
 * double-enqueued every cron. The split is opt-in from the development side
 * (USE_REPLIT_DEV_DB), because DATABASE_URL is platform-managed and carries the
 * same value in both environments.
 *
 * These tests pin the two things that make the split trustworthy: production
 * resolution is untouched without the flag, and the flag refuses to pretend.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Only the pause switch is stubbed, and only so the cases that get PAST the
// block do not need a live database to prove they got past it.
vi.mock("../lib/app-settings", () => ({
  isAutomationPaused: vi.fn(async () => false),
  AUTOMATION_PAUSED_ERROR: "Automation is fully paused.",
}));

import { config, pgSslFor } from "../lib/config";
// Deliberately NOT mocked. The point of these tests is that the real transport
// refuses, so a mock would assert nothing.
import { gmail } from "../lib/integrations/gmail";
import { systemMail } from "../lib/integrations/system-mail";

const PROD_URL = "postgres://prod_owner:secret@ep-example-123.us-east-1.aws.neon.tech/neondb";

const TOUCHED = [
  "DATABASE_URL",
  "USE_REPLIT_DEV_DB",
  "ALLOW_REAL_EMAIL_FROM_DEV",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "NODE_ENV",
  "VITEST",
  "REPLIT_DEPLOYMENT",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  process.env.DATABASE_URL = PROD_URL;
  process.env.PGHOST = "helium";
  process.env.PGPORT = "5432";
  process.env.PGUSER = "postgres";
  process.env.PGPASSWORD = "dev pass/word";
  process.env.PGDATABASE = "heliumdb";
  delete process.env.USE_REPLIT_DEV_DB;
  delete process.env.ALLOW_REAL_EMAIL_FROM_DEV;
  delete process.env.REPLIT_DEPLOYMENT;
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.clearAllMocks();
});

describe("which database a process talks to", () => {
  it("uses the production connection when the development flag is absent", () => {
    expect(config.database.url).toBe(PROD_URL);
    expect(config.database.isIsolatedDev).toBe(false);
  });

  it("leaves production alone even when the built-in database is present", () => {
    // The PG* variables exist in both environments. On their own they must
    // change nothing, or production would silently follow development.
    process.env.USE_REPLIT_DEV_DB = "false";
    expect(config.database.url).toBe(PROD_URL);
  });

  it("points development at the repl's own database when the flag is set", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    const url = new URL(config.database.url);
    expect(url.hostname).toBe("helium");
    expect(url.pathname).toBe("/heliumdb");
    expect(config.database.isIsolatedDev).toBe(true);
  });

  it("escapes credentials so an awkward password still yields a usable URL", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    const url = new URL(config.database.url);
    expect(decodeURIComponent(url.password)).toBe("dev pass/word");
    expect(url.hostname).toBe("helium");
  });

  /**
   * The dangerous failure is not an error, it is a false sense of safety: a
   * developer believing they are isolated while writing to live customer data.
   */
  it("refuses to claim isolation when both point at the same server", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    process.env.PGHOST = "ep-example-123.us-east-1.aws.neon.tech";
    expect(() => config.database.url).toThrow(/same server/i);
  });

  it("refuses to fall back to production when the built-in database is missing", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    delete process.env.PGHOST;
    expect(() => config.database.url).toThrow(/PGHOST/);
  });

  /**
   * The catastrophic case: the flag escapes into the published app, which then
   * serves real customers from an empty development database. Crashing is the
   * mild outcome, so this must not be a warning.
   */
  it("refuses to start if the development flag reaches a deployed environment", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    process.env.REPLIT_DEPLOYMENT = "1";
    expect(() => config.database.url).toThrow(/deployed environment/i);
  });

  it("refuses when it cannot parse production's connection to compare against", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    process.env.DATABASE_URL = "this is not a url";
    expect(() => config.database.url).toThrow(/could not be parsed/i);
  });

  it("refuses malformed built-in settings rather than building a bad URL", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    process.env.PGHOST = "helium/../evil";
    expect(() => config.database.url).toThrow(/malformed/i);
  });

  it("treats the same server on the default port as the same server", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    process.env.PGHOST = "ep-example-123.us-east-1.aws.neon.tech";
    process.env.PGPORT = "5432";
    // Production's URL carries no explicit port, so a naive comparison would
    // read these as different endpoints and wave the collision through.
    expect(() => config.database.url).toThrow(/same server/i);
  });
});

describe("TLS choice per database", () => {
  it("requires TLS for a managed provider", () => {
    expect(pgSslFor(PROD_URL)).toEqual({ rejectUnauthorized: false });
  });

  it("does not force TLS on a loopback database", () => {
    expect(pgSslFor("postgres://u:p@localhost:5432/app")).toBeUndefined();
    expect(pgSslFor("postgres://u:p@127.0.0.1:5432/app")).toBeUndefined();
  });

  it("honours an explicit sslmode=disable", () => {
    expect(pgSslFor(`${PROD_URL}?sslmode=disable`)).toBeUndefined();
  });

  /**
   * A private DNS name is not evidence that a database is local. Guessing from
   * the hostname would send real credentials over that network in the clear.
   */
  it("keeps TLS for an internal-looking hostname that never said to drop it", () => {
    expect(pgSslFor("postgres://u:p@db-internal:5432/app")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("drops TLS for the built-in database because its URL says so, not its name", () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    expect(pgSslFor(config.database.url)).toBeUndefined();
  });
});

/**
 * The guard lives in the Gmail transport, the one place every sender passes
 * through: tenant outreach, platform system mail, and backlink outreach. These
 * tests call the real transport rather than a mock, because a mock would prove
 * only that the mock was called.
 */
describe("outbound email from a development process", () => {
  const PARAMS = {
    to: "sub@example.com",
    subject: "Invitation to quote",
    html: "<p>We have a project that fits your trade.</p>",
    text: "We have a project that fits your trade.",
  };

  const BLOCKED = /development environment/i;

  it("does not reach a real inbox while pointed at the development database", async () => {
    process.env.USE_REPLIT_DEV_DB = "true";

    const result = await gmail.send(PARAMS);

    expect(result.disabled).toBe(true);
    expect(result.error).toMatch(BLOCKED);
    expect(result.messageId).toBeUndefined();
  });

  /**
   * Password resets, digests, and operator alerts do not go through the
   * outreach transport, so guarding outreach alone would have left them live.
   */
  it("blocks platform system mail on the same rule", async () => {
    process.env.USE_REPLIT_DEV_DB = "true";

    const result = await systemMail.send({
      to: "owner@example.com",
      subject: "Reset your password",
      text: "Use this link to choose a new password.",
    });

    expect(result.disabled).toBe(true);
    expect(result.error).toMatch(BLOCKED);
  });

  it("applies during the test suite too, so an unmocked send cannot slip out", async () => {
    // Tests inherit the development flags. Exempting them would mean any new
    // sending path added without a mock could deliver for real.
    process.env.USE_REPLIT_DEV_DB = "true";
    process.env.NODE_ENV = "test";
    process.env.VITEST = "true";

    const result = await gmail.send(PARAMS);

    expect(result.disabled).toBe(true);
    expect(result.error).toMatch(BLOCKED);
  });

  /** Past the block, the send fails on a missing inbox or database instead. */
  const attempt = async () =>
    gmail.send(PARAMS).catch((err: unknown) => ({ error: String(err) }));

  it("steps aside when someone deliberately asks to test delivery", async () => {
    process.env.USE_REPLIT_DEV_DB = "true";
    process.env.ALLOW_REAL_EMAIL_FROM_DEV = "true";

    // What matters is that the refusal is no longer ours.
    expect(((await attempt()).error ?? "")).not.toMatch(BLOCKED);
  });

  it("does not interfere when the process is on the production database", async () => {
    // No development flag, so the guard must not fire at all.
    expect(((await attempt()).error ?? "")).not.toMatch(BLOCKED);
  });
});
