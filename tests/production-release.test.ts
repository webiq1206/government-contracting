import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const check = (overrides: Record<string, string>) => spawnSync(process.execPath,
  ["--import", "tsx", "scripts/production-release.ts"], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, MIGRATION_DATABASE_URL: "", EXPECTED_DATABASE_HOST: "", EXPECTED_DATABASE_NAME: "", RELEASE_ACTION: "inspect", USE_REPLIT_DEV_DB: "false", ...overrides },
  });

describe("manual owner release", () => {
  it("fails before connecting when credentials or target metadata are missing", () => {
    const result = check({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Configure the owner-only migration secret");
  });
  it("rejects a mismatched host without printing the credential", () => {
    const result = check({ MIGRATION_DATABASE_URL: "postgresql://owner:fake-password@wrong.invalid/neondb", EXPECTED_DATABASE_HOST: "right.invalid", EXPECTED_DATABASE_NAME: "neondb" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match");
    expect(result.stderr).not.toContain("fake-password");
  });
  it("requires the expected database as well as the host", () => {
    const result = check({ MIGRATION_DATABASE_URL: "postgresql://owner@right.invalid/wrong", EXPECTED_DATABASE_HOST: "right.invalid", EXPECTED_DATABASE_NAME: "neondb" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match");
  });
  it("never auto-runs on push and keeps the secret out of dependency installation", () => {
    const workflow = readFileSync(".github/workflows/production-migrations.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain("default: inspect");
    expect(workflow).toContain("environment: production-migrations");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("--ignore-scripts");
    expect(workflow.indexOf("secrets.MIGRATION_DATABASE_URL")).toBeGreaterThan(workflow.indexOf("npx --no-install tsx"));
  });
});
