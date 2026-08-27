/**
 * Every table that stores a storage key must be resolvable back to an org.
 *
 * lib/domain/file-ownership.ts is the only thing standing between a flat
 * storage namespace and one tenant reading another's certificates. It works by
 * enumerating the tables that reference a key, which means it fails in the
 * quietest possible way when a new table is added and not listed: the files
 * are refused, to everybody, with a 404 that reads exactly like a missing
 * file. Nobody reports it as a bug against the resolver.
 *
 * This reads the migrations for tables carrying a storage_path column and
 * insists each one appears in the resolver.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");

/** Tables that hold a storage key but are deliberately never served. */
const NOT_SERVED = new Map<string, string>([
  // Not a document table: it is the blob store itself, and every read of it
  // goes through a key that one of the listed tables owns.
  ["file_blobs", "The blob store. Ownership is resolved from the tables that reference the key."],
]);

function migrationText(): string {
  const dir = path.join(ROOT, "db", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

/**
 * Table names that still have a storage_path column at the end of the
 * migration history.
 *
 * A later drop counts: 091 gave compliance_items one and 094 took it away, and
 * reading only the adds would demand a resolver lookup against a column that
 * no longer exists.
 */
function tablesWithStorageKeys(sql: string): Set<string> {
  const found = new Set<string>();

  const creates = sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi
  );
  for (const m of creates) {
    if (/^\s*storage_path\s/mi.test(m[2])) found.add(m[1].toLowerCase());
  }

  const alters = [
    ...sql.matchAll(/alter\s+table\s+(?:only\s+)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi),
  ];
  for (const m of alters) {
    if (/add\s+column[^;]*?\bstorage_path\b/i.test(m[2])) found.add(m[1].toLowerCase());
  }
  // Applied in file order, so a drop after an add wins and an add after a
  // drop puts it back.
  for (const m of alters) {
    if (/drop\s+column[^;]*?\bstorage_path\b/i.test(m[2])) found.delete(m[1].toLowerCase());
  }

  return found;
}

describe("storage key ownership", () => {
  const sql = migrationText();
  const resolver = readFileSync(path.join(ROOT, "lib", "domain", "file-ownership.ts"), "utf8");

  it("finds the tables it is supposed to check", () => {
    // A regex that matched nothing would make every assertion below vacuous.
    const tables = tablesWithStorageKeys(sql);
    expect(tables.has("documents")).toBe(true);
    expect(tables.has("subcontractor_documents")).toBe(true);
    expect(tables.has("compliance_item_documents")).toBe(true);
  });

  it("resolves every table that stores a key", () => {
    const missing: string[] = [];
    for (const table of tablesWithStorageKeys(sql)) {
      if (NOT_SERVED.has(table)) continue;
      if (!new RegExp(`from\\s+${table}\\b`).test(resolver)) missing.push(table);
    }
    expect(
      missing,
      `These tables store file keys that lib/domain/file-ownership.ts never resolves, so their files are refused to everybody: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("never treats a bare key as proof of access", () => {
    // The whole point of the module. If it ever returns an org for a key it
    // did not find in a table, guessable keys become readable.
    expect(resolver).toContain("owner != null && owner === orgId");
  });

  it("drops a column rather than leaving a second place for a file to live", () => {
    // 091 gave compliance_items its own storage_path before 093 replaced it
    // with a table. A column nothing writes reads as "no document on file"
    // forever, which is the failure this whole area exists to prevent.
    expect(sql).toMatch(/alter table compliance_items[\s\S]*?add column if not exists storage_path/i);
    expect(sql).toMatch(/alter table compliance_items[\s\S]*?drop column if exists storage_path/i);
    // And so it is not something the resolver has to account for.
    expect(tablesWithStorageKeys(sql).has("compliance_items")).toBe(false);
  });
});
