import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const helper = readFileSync("lib/sub-access.ts", "utf8");

describe("operator subcontractor access", () => {
  it("requires an explicit organization and has no unscoped fallback", () => {
    expect(helper).toContain("subId: string,\n  orgId: string");
    expect(helper).toContain("where id = $1 and org_id = $2");
    expect(helper).not.toContain("tryResolveTenantOrgId");
    expect(helper).not.toContain("catch");
  });

  it.each([
    "app/api/subs/[id]/documents/route.ts",
    "app/api/subs/[id]/documents/[docId]/route.ts",
    "app/api/subs/[id]/portal-link/route.ts",
  ])("passes the guarded organization in %s", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("loadSubForOperator(params.id, orgId)");
  });
});
