import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("release migrations are separate from restricted runtime", () => {
  it("never runs owner migrations from the web or worker start commands", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const worker = read("worker/index.ts");

    expect(pkg.scripts["start:web"]).toContain("verify-schema.ts");
    expect(pkg.scripts["start:web"]).not.toContain("migrate.ts");
    expect(worker).toContain("verifyMigrationsCurrent");
    expect(worker).not.toContain("applyMigrations");
  });

  it("requires a dedicated owner connection for production migration runs", () => {
    const migrate = read("lib/migrate.ts");
    expect(migrate).toContain("MIGRATION_DATABASE_URL is required for production migrations");
    expect(migrate).toContain("connectionString: dedicatedUrl || config.database.url");
  });

  it("makes an outdated schema a startup failure instead of serving partial behavior", () => {
    const migrate = read("lib/migrate.ts");
    expect(migrate).toContain("export async function verifyMigrationsCurrent");
    expect(migrate).toContain("Database schema is behind this release");
  });

  it("detects edited migrations and requires an explicit reviewed legacy baseline", () => {
    const migrate = read("lib/migrate.ts");
    expect(migrate).toContain('createHash("sha256")');
    expect(migrate).toContain("Applied migration files changed after installation");
    expect(migrate).toContain('ALLOW_MIGRATION_CHECKSUM_BASELINE !== "1"');
    expect(migrate).toContain("insert into _migrations (name, checksum)");
    expect(migrate).toContain("alter column checksum set not null");
  });
});
