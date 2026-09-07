import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("skip-call tenant and suppression atomicity", () => {
  it("locks the tenant-owned card and writes its suppression before commit", () => {
    const source = readFileSync("lib/skip-call.ts", "utf8");
    const skip = source.slice(
      source.indexOf("export async function skipCallCard"),
      source.indexOf("async function restoreSkippedCallCard")
    );

    expect(skip).toMatch(/where cc\.id = \$1 and cc\.org_id = \$2[\s\S]*for update/);
    expect(skip).toContain("await suppress(");
    expect(skip).toMatch(/await suppress\([\s\S]*,\s*c\s*\)/);
    expect(skip).toContain("sourceCallCardId: callCardId");
    expect(skip).not.toContain(".catch(() => undefined)");
  });

  it("requires every caller to supply the organization", () => {
    const source = readFileSync("lib/skip-call.ts", "utf8");
    expect(source).toContain("orgId: string;");
    expect(source).not.toContain("orgId?: string;");
  });

  it("undo lifts only the suppression created by that call card", () => {
    const source = readFileSync("lib/skip-call.ts", "utf8");
    const restore = source.slice(source.indexOf("async function restoreSkippedCallCard"));
    expect(restore).toMatch(
      /update outreach_suppressions[\s\S]*where source_call_card_id = \$1 and org_id = \$2/
    );
    expect(restore).toContain("skip_reason = null");
    expect(restore).toContain("skip_scope = null");
  });

  it("reports infrastructure failure as unavailable instead of user error", () => {
    const route = readFileSync("app/api/call-cards/[id]/skip/route.ts", "utf8");
    expect(route).toContain("err instanceof SuppressionRejected");
    expect(route).toContain("{ status: 503 }");
    expect(route).toContain("so no change was completed");
  });
});
