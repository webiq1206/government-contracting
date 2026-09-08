import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

function functionBody(path: string, name: string, next: string): string {
  const text = source(path);
  const start = text.indexOf(`export async function ${name}`);
  const end = text.indexOf(next, start);
  expect(start, `${name} was not found`).toBeGreaterThanOrEqual(0);
  expect(end, `${name} end marker was not found`).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("unknown internal state is not rendered as empty or healthy", () => {
  it("lets provider and content read failures reach their pages", () => {
    const provider = functionBody("lib/data.ts", "providerUsage", "/**\n * How many opportunities");
    const content = functionBody("lib/data.ts", "contentLibrary", "/* ------------------------------------------------------------------------ */");

    expect(provider).not.toContain(".catch(() =>");
    expect(content).not.toContain("catch");
  });

  it("replaces the provider panel with an unavailable state after a failed read", () => {
    const page = source("app/(dash)/agents/page.tsx");
    expect(page).toContain("The AI credential source, allowance, and 24-hour usage could not be read");
    expect(page).toContain("Provider status is unavailable");
    expect(page).toContain("{provider ? (");
  });

  it("does not offer edits against a fabricated empty snippet list", () => {
    const page = source("app/(dash)/settings/content/page.tsx");
    expect(page).toContain("snippetsUnavailable");
    expect(page).toContain("snippet changes are disabled");
    expect(page).toContain("Proposal snippets (status unavailable)");
  });

  it("surfaces setup helper warnings on both dashboard checklists", () => {
    expect(source("app/(dash)/today/page.tsx")).toContain(
      "loadWarnings.push(...setup.warnings)"
    );
    const knowledge = source("app/(dash)/how-it-works/page.tsx");
    expect(knowledge).toContain("...facts.warnings, ...setup.warnings");
    expect(knowledge).toContain("Quick-start progress unavailable");
  });

  it("makes recap settings read failures visible and non-editable", () => {
    const settings = functionBody("lib/recap/settings.ts", "getRecapSettings", "/** Whether anybody");
    expect(settings).not.toContain("catch");

    const page = source("app/(dash)/settings/recap/page.tsx");
    expect(page).toContain('"Settings unavailable"');
    expect(page).toContain("readOnly={!editable || settingsUnavailable}");
    expect(page).toContain("Defaults are shown only as a preview");
  });

  it("does not turn failed pipeline pulse reads into healthy values", () => {
    const pulse = functionBody("lib/pipeline-pulse.ts", "readPipelinePulse", "return evaluatePulse");
    expect(pulse).not.toContain(".catch(() =>");
    expect(source("app/(dash)/today/page.tsx")).toContain(
      "Pipeline alerts could not be checked"
    );
  });

  it("keeps platform recap failures distinct from a quiet day", () => {
    const gather = functionBody("lib/recap/platform.ts", "gatherPlatformFacts", "function section");
    expect(gather).not.toContain(".catch(() =>");

    const page = source("app/(dash)/admin/recap/page.tsx");
    expect(page).toContain('"Recap data unavailable"');
    expect(page).toContain("not a day with zero failures");
  });

  it("marks partial recap settings API results instead of returning silent empty arrays", () => {
    const route = source("app/api/recap/settings/route.ts");
    expect(route).toContain("unavailable.push");
    expect(route).toContain("recipientsAvailable");
    expect(route).toContain("Empty arrays for those sections do not mean there are no records");
  });
});
