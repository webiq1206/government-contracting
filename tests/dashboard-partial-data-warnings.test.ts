import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("dashboard partial-data failures stay visible", () => {
  it.each([
    [
      "opportunity pipeline",
      "app/(dash)/pipeline/page.tsx",
      "Trade coverage could not be checked",
    ],
    [
      "contracts workspace",
      "app/(dash)/contracts/page.tsx",
      "selected contract detail could not be loaded",
    ],
    [
      "contract detail",
      "app/(dash)/contracts/[id]/page.tsx",
      "contract owner could not be loaded",
    ],
    [
      "compliance board",
      "app/(dash)/compliance/page.tsx",
      "Compliance documents could not be loaded",
    ],
    [
      "subcontractor roster",
      "app/(dash)/subs/page.tsx",
      "Assignable team members could not be loaded",
    ],
    [
      "subcontractor detail",
      "app/(dash)/subs/[id]/page.tsx",
      "Saved reply drafts could not be loaded",
    ],
    [
      "daily recap",
      "app/(dash)/recap/page.tsx",
      "account start date could not be loaded",
    ],
    [
      "automation health",
      "app/(dash)/agents/page.tsx",
      "Recovery incidents could not be synchronized",
    ],
    [
      "search",
      "app/(dash)/search/page.tsx",
      "protected result actions are disabled",
    ],
    [
      "knowledge center",
      "app/(dash)/how-it-works/page.tsx",
      "Gmail connection could not be checked",
    ],
    [
      "automation rules",
      "app/(dash)/settings/rules/page.tsx",
      "automation rules are read-only",
    ],
    [
      "content library",
      "app/(dash)/settings/content/page.tsx",
      "content editing is disabled",
    ],
    [
      "platform recap",
      "app/(dash)/admin/recap/page.tsx",
      "selected account preview could not be loaded",
    ],
    [
      "opportunity detail",
      "app/(dash)/opportunity/[id]/page.tsx",
      "Source verification status could not be loaded",
    ],
    [
      "opportunity requirements",
      "app/(dash)/opportunity/[id]/requirements/page.tsx",
      "Requirement progress could not be loaded",
    ],
    [
      "feedback",
      "app/(dash)/feedback/page.tsx",
      "Previous feedback could not be loaded",
    ],
  ])("shows a warning when %s is only partly loaded", (_name, path, message) => {
    const page = source(path);
    expect(page).toContain("ShellDataWarning");
    expect(page).toContain(message);
  });

  it("does not describe a failed recap preference read as the user's own time zone", () => {
    const page = source("app/(dash)/recap/page.tsx");
    expect(page).toContain("preferenceLoadFailed");
    expect(page).toContain(
      'the default because your saved time zone could not be checked'
    );
  });

  it("labels Today dates as using the default when its saved time zone is unavailable", () => {
    const page = source("app/(dash)/today/page.tsx");
    expect(page).toContain("Your saved time zone could not be loaded");
    expect(page).toContain("day boundaries may differ from your account");
    expect(page).not.toContain("getUserRecapPreference(viewer.id).catch(() => null)");
  });

  it("marks knowledge center profile and inbox evidence unknown on read failure", () => {
    const page = source("app/(dash)/how-it-works/page.tsx");
    expect(page).toContain("profileLoadFailed");
    expect(page).toContain("inboxLoadFailed");
    expect(page).toContain("Reload before reconnecting or sending outreach");
  });

  it("keeps the platform authority page fail-closed when identity cannot be read", () => {
    const page = source("app/(dash)/authority/page.tsx");
    expect(page).toContain("const user = await currentUser()");
    expect(page).not.toContain("currentUser().catch(() => null)");
    expect(page).toContain("if (!isPlatformAdmin(user?.email)) notFound()");
  });
});
