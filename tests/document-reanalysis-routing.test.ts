import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("document correction re-analysis routing", () => {
  const analyst = readFileSync("lib/agents/solicitation-analyst.ts", "utf8");
  const retry = readFileSync("app/api/documents/[id]/retry/route.ts", "utf8");
  const replace = readFileSync("app/api/documents/[id]/replace/route.ts", "utf8");

  it("makes retry bypass the unchanged-input optimization and request a rescore", () => {
    expect(retry).toContain('force: "always"');
    expect(retry).toContain("rescoreAfterAnalysis: true");
    expect(analyst).toContain('ctx.payload.force === "always"');
    expect(analyst).toContain('ctx.payload.force !== "always"');
  });

  it("reads the replacement bytes and suppresses the superseded remote source", () => {
    expect(replace).toContain("source_system, source_url, original_filename, meta");
    expect(replace).toContain("'operator_replacement'");
    expect(replace).toContain('force: "always"');
    expect(analyst).toContain("processStoredAnalysisSource");
    expect(analyst).toContain("storage.download(source.storage_path");
    expect(analyst).toContain("replacementKeys.has(key)");
  });

  it("changes source versions in one database transaction", () => {
    expect(analyst).toContain("pg_advisory_xact_lock");
    expect(replace).toContain("for update");
    expect(replace).toContain("transaction(async");
  });
});
