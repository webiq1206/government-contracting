import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const DATA = readFileSync("lib/data.ts", "utf8");

function body(name: string, next: string): string {
  return DATA.slice(
    DATA.indexOf(`export async function ${name}`),
    DATA.indexOf(`export async function ${next}`)
  );
}

describe("tenant reads fail closed", () => {
  it("never turns missing request context into the founding account", () => {
    const current = body("currentOrg", "queueCounts");
    expect(current).toContain("resolveTenantOrgId");
    expect(current).not.toContain("LEGACY_ORG_ID");
    expect(current).not.toContain("??");
  });

  it("requires an organization before loading a subcontractor and all related rows", () => {
    const detail = body("subDetail", "complianceBoard");
    expect(detail).toContain("const orgId = await currentOrg()");
    expect(detail).toContain("id=$1 and org_id=$2");
    expect(detail).not.toContain("select * from subcontractors where id=$1`");
    expect(detail).toContain("c.org_id = $2");
    expect(detail).toContain("q.org_id=$2");
  });

  it("scopes every opportunity detail collection and does not hide a broken call query", () => {
    const detail = body("opportunityDetail", "pricingSummaryFor");
    expect(detail).toContain("bids where opportunity_id=$1 and org_id=$2");
    expect(detail).toContain("q.opportunity_id=$1 and q.org_id=$2");
    expect(detail).toContain("documents where opportunity_id=$1 and org_id=$2");
    expect(detail).toContain("where opportunity_id = $1 and org_id = $2");
    expect(detail).toContain("cc.opportunity_id = $1 and cc.org_id = $2");
    expect(detail).toContain("cc.card_json->>'trade'");
    expect(detail).not.toContain("cc.trade");
    expect(detail).not.toContain(").catch(() => [])");
  });

  it.each([
    "lib/integration-keys.ts",
    "lib/integration-settings.ts",
    "lib/ai/claude.ts",
    "lib/ai/contentLibrary.ts",
    "lib/automation-status.ts",
    "lib/pipeline-pulse.ts",
    "lib/integration-health.ts",
    "lib/backlink-send.ts",
    "lib/app-settings.ts",
  ])("does not borrow the founding tenant when context is missing in %s", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).not.toContain("tryResolveTenantOrgId()) ?? LEGACY_ORG_ID");
  });

  it("does not convert an unavailable automation switch into permission to run", () => {
    const source = readFileSync("lib/app-settings.ts", "utf8");
    const getSetting = source.slice(
      source.indexOf("async function getSetting"),
      source.indexOf("async function setSetting")
    );
    const platformState = source.slice(
      source.indexOf("export async function getPlatformAutomationState"),
      source.indexOf("export async function isPlatformAutomationPaused")
    );
    expect(source).toContain("resolveTenantOrgId");
    expect(source).not.toContain("tryResolveTenantOrgId");
    expect(platformState).not.toContain(".catch");
    expect(getSetting).not.toMatch(/catch\s*\{/);
  });

  it.each([
    "app/api/documents/[id]/route.ts",
    "app/api/documents/[id]/open/route.ts",
    "app/api/documents/[id]/retry/route.ts",
    "app/api/documents/[id]/replace/route.ts",
  ])("never treats an unowned document as belonging to the founding tenant in %s", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).not.toContain("LEGACY_ORG_ID");
    expect(source).not.toContain("doc.org_id === null");
    expect(source).toMatch(/where id\s*=\s*\$1 and org_id\s*=\s*\$2/i);
  });
});
