import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORPHAN_LEDGER_CHECKSUM, baselinePlan } from "../lib/migrate";

/*
 * The production release on 2026-09-08 stopped at the not-null step: the
 * ledger held a row for 034_sending_domains.sql, a migration that ran once and
 * whose file was later removed from the repo (036 drops its table). The
 * baseline hashed the 101 rows that still had files, then `alter column
 * checksum set not null` failed on the one that did not, and migrations
 * 102-110 never applied. Every runtime process then refused to start.
 *
 * A row like that has to be part of the same baseline step as the legacy
 * rows, not discovered by a constraint failure after them.
 */
describe("migration ledger baseline", () => {
  const files = ["000_init.sql", "001_bid_tracking.sql", "036_gmail_sender_identity.sql"];

  it("splits unverified ledger rows into ones with a file and ones without", () => {
    const plan = baselinePlan(files, [
      { name: "000_init.sql", checksum: null },
      { name: "001_bid_tracking.sql", checksum: "abc" },
      { name: "034_sending_domains.sql", checksum: null },
      { name: "036_gmail_sender_identity.sql", checksum: null },
    ]);
    expect(plan.legacy).toEqual(["000_init.sql", "036_gmail_sender_identity.sql"]);
    expect(plan.orphans).toEqual(["034_sending_domains.sql"]);
  });

  it("does not treat an already-marked orphan as unfinished work", () => {
    const plan = baselinePlan(files, [
      { name: "000_init.sql", checksum: "abc" },
      { name: "034_sending_domains.sql", checksum: ORPHAN_LEDGER_CHECKSUM },
    ]);
    expect(plan.legacy).toEqual([]);
    expect(plan.orphans).toEqual([]);
  });

  it("reports nothing to baseline on a fully verified ledger", () => {
    const plan = baselinePlan(files, [
      { name: "000_init.sql", checksum: "a" },
      { name: "001_bid_tracking.sql", checksum: "b" },
    ]);
    expect(plan).toEqual({ legacy: [], orphans: [] });
  });

  it("marks orphans inside the reviewed baseline, before the column goes not-null", () => {
    const migrate = readFileSync("lib/migrate.ts", "utf8");
    const baseline = migrate.indexOf("for (const name of orphans)");
    const notNull = migrate.indexOf("alter column checksum set not null");
    expect(baseline).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(baseline);
    expect(migrate).toContain("[name, ORPHAN_LEDGER_CHECKSUM]");
    // The unflagged run has to name the orphan too, or the operator is sent to
    // compare a schema against a file that does not exist.
    expect(migrate).toContain("no file in this build");
  });

  it("keeps the runtime gate blind to orphan rows, which it cannot verify", () => {
    const migrate = readFileSync("lib/migrate.ts", "utf8");
    const gate = migrate.slice(
      migrate.indexOf("export async function verifyMigrationsCurrent"),
      migrate.indexOf("async function run(")
    );
    // Every check in the gate iterates the expected files, never the ledger,
    // so a marked orphan row neither passes nor fails it.
    expect(gate).toContain("[...expected.keys()].filter");
    expect(gate).not.toContain("ORPHAN_LEDGER_CHECKSUM");
  });
});
