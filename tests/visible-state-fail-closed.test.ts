import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

function functionBody(source: string, start: string, next?: string): string {
  const from = source.indexOf(start);
  const to = next ? source.indexOf(next, from) : source.length;
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("user-visible data failures fail closed", () => {
  it("does not convert membership or tenant lookup outages into logout or founding-tenant state", () => {
    const auth = read("lib/auth.ts");
    const attach = functionBody(auth, "async function attachOrg", "/**\n * The device");
    const tenant = read("lib/tenant.ts");
    const acting = functionBody(
      read("lib/tenant-context.ts"),
      "export async function actingOrgId",
      "}"
    );
    const profile = functionBody(
      read("lib/ai/companyProfile.ts"),
      "async function resolveProfileOrgId",
      "export async function getActiveProfile"
    );

    expect(attach).not.toContain("catch");
    expect(tenant).toContain("MissingTenantContextError");
    expect(tenant).toContain("error instanceof MissingTenantContextError");
    expect(tenant).not.toContain("currentUser().catch");
    expect(acting).not.toContain("catch");
    expect(profile).toContain("resolveTenantOrgId");
    expect(profile).not.toContain("LEGACY_ORG_ID");

    for (const path of [
      "app/(dash)/layout.tsx",
      "app/(account)/layout.tsx",
      "app/login/page.tsx",
      "app/signup/page.tsx",
      "app/setup/page.tsx",
      "app/billing/success/page.tsx",
    ]) {
      const layout = read(path);
      expect(layout).toContain("SessionLoadFailure");
      expect(layout).toContain("if (!auth.ok)");
      expect(layout).not.toContain("currentUser().catch(() => null)");
    }
  });

  it("does not claim a security-sensitive session delete succeeded when it failed", () => {
    const auth = read("lib/auth.ts");
    const end = functionBody(auth, "export async function endImpersonation", "export async function resolveSession");
    const destroy = functionBody(auth, "export async function destroySession", "// ---- Next.js cookie helpers");
    expect(end).not.toContain("catch");
    expect(destroy).not.toContain("catch");
  });

  it("propagates subcontractor compliance reads and disables document UI when the page catch runs", () => {
    const store = read("lib/sub-compliance-store.ts");
    const docs = functionBody(store, "export async function loadComplianceDocs", "export interface ComplianceView");
    const portalStore = functionBody(store, "export async function loadPortalSubject", "/**\n * Retire");
    const awards = functionBody(
      store,
      "export async function loadAwardCompliance",
      "export function needsAttentionOnWonWork"
    );
    const detail = read("app/(dash)/subs/[id]/page.tsx");
    const board = read("app/(dash)/compliance/page.tsx");

    expect(docs).not.toContain("catch");
    expect(portalStore).not.toContain("catch");
    expect(awards).not.toContain("catch");
    expect(detail).toContain("Paperwork status is unknown and document actions are disabled");
    expect(detail).toContain("Paperwork status unknown");
    expect(detail).toContain("Upload, verification,");
    expect(board).toContain("if (documentsUnavailable)");
    expect(board).toContain("No item is being called complete or missing");

    const portal = read("app/vendor/[token]/page.tsx");
    const upload = read("app/api/vendor/[token]/documents/route.ts");
    const w9 = read("app/api/vendor/[token]/w9/route.ts");
    expect(portal).toContain("Your link has not been rejected");
    expect(portal).toContain("nothing needs to be uploaded again");
    expect(upload).toContain("status: 503");
    expect(upload).toContain("Nothing was uploaded");
    expect(w9).toContain("status: 503");
    expect(w9).toContain("Nothing was signed or saved");
  });

  it("keeps a selected workbench read failure distinct from completed or removed work", () => {
    const store = read("lib/workbench.ts");
    const detail = functionBody(store, "export async function loadWorkbenchDetail", "/** Whether this account");
    const page = read("app/(dash)/workbench/page.tsx");

    expect(detail).not.toContain(".catch(() => null)");
    expect(page).toContain("selectedDetailUnavailable");
    expect(page).toContain("It has not been treated as finished or removed");
    expect(page).toContain("nothing has been marked complete");
  });

  it("lets feedback history failures reach the page warning and API failure path", () => {
    const store = read("lib/feedback.ts");
    const list = functionBody(store, "export async function feedbackFor", "/** One report");
    const one = functionBody(store, "export async function feedbackReport");
    const page = read("app/(dash)/feedback/page.tsx");

    expect(list).not.toContain("catch");
    expect(one).not.toContain("catch");
    expect(page).toContain("Previous feedback could not be loaded");
    expect(page).toContain("ShellDataWarning");
  });
});
